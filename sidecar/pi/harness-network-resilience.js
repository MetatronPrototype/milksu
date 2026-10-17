// 新引擎网络韧性（批次 R1a）：重试策略 + 挂死看门狗 + 错误分类标记。
//
// 背景（REALUSE-audit-20261012.md D1）：β.190 真机一晚三起事故——模型调用挂死 20 分钟
// 无看门狗杀、网络类错误直接判死回合、用户消息排队不可见。老引擎（bridge.js 路径）有
// bridge-request-budget-stream.js 的预算看门狗，harness 路径（MILKSU_PI_HARNESS 门开）
// 完全没接。本模块把三件事接到 harness 路径上，全部**不自造轮子**：
//
//   1. 重试策略：pi-durable 1.1.0 的 GenerationTask 自带 durable 重试（checkpoint 化，
//      generation.js classify：isRetryableAssistantError 判定 + settings.retry 预算 +
//      retryDelayMs 退避 + live.generation.retry 状态），本模块只提供
//      harnessRetryPolicy() 喂给 HarnessOptions.settings.retry（harness-bridge-session
//      openRuntime 接线）。最多 5 次重试，退避序列 baseDelayMs × 2^(n-1)。
//   2. 挂死看门狗：包在 pi-ai Models 集合的 streamSimple/stream 上（provider 注册的
//      单一收口——ModelsImpl.streamSimple 经 applyAuth 后分发到 setProvider 注册的
//      provider，在这里包住即可覆盖账号/自有/路由三路，也覆盖测试预注册的 faux）。
//      软阈值（默认 90s）只发 onStall 事件不杀；硬阈值（默认 180s）abort 流并抛
//      「可重试」错误，让引擎的原生重试接管。阈值语义对齐老引擎
//      bridge-request-budget-stream.js（软告警 → 宽限 → 硬掐；guard.note() 有进展
//      就续命），但阈值是平面值（不按请求体积伸缩）——R1a 的规格就是平面值。
//      R1b 增补：同一个包装点加 onEvent 只读 tap，原始流事件（thinking/text delta
//      等）实时转发给会话层的流式旁路（harness-bridge-session），不等
//      settings.progress.partialIntervalMs（默认 100ms）的落盘节流 + commit 投影。
//      双层包装（route 内层来源流 + 外层 route 流）按事件对象身份只 tap 一次。
//   3. 错误分类标记：密钥无效/欠费/权限类错误不能被重试。pi-ai 的
//      isRetryableAssistantError 靠 errorMessage 正反两张表判定（NON_RETRYABLE 表
//      认 billing/insufficient_quota 等；其余要命中 RETRYABLE 表才算可重试），但
//      「Provider returned error: 401 Incorrect API key」这类文案会命中 RETRYABLE 表
//      的 provider.?returned.?error 而被白白重试 5 次。markProviderErrorMessage 在
//      provider 层给这类文案追加标记：fatal 追加含 "billing" 的后缀（NON_RETRYABLE
//      表必中 ⇒ 不可重试）；transient 但 pi-ai 不认的（如裸 ECONNRESET）追加含
//      "network error" 的后缀（RETRYABLE 表必中 ⇒ 可重试）。已是目标分类的文案不动。
//
// 与老引擎的差异（有意为之）：老引擎的预算看门狗 TTFB 按请求体积伸缩 + 断流 30s/宽限
// 120s；R1a 规格是平面软 90s/硬 180s，全部可经环境变量覆盖后再标定。

import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";

// ---------- 重试策略（喂给 pi-durable settings.retry） ----------

/**
 * 引擎级重试预算。pi-durable generation.js 的判定是 attempt <= maxRetries（attempt 从
 * 1 起），所以 maxRetries: 5 = 1 次首发 + 5 次重试，共 6 次调用。
 *
 * 退避序列（pi-ai retry.js retryDelayMs：baseDelayMs × 2^(n-1)，封顶 maxAgentDelayMs）：
 * baseDelayMs 1500 ⇒ 1.5s/3s/6s/12s/24s，累计 46.5s，落在 30-60s 总窗口的中段。
 * 选 1500 的理由：网络抖动（ECONNRESET、瞬时 5xx）通常几秒内自愈，首退避 1.5s 足够
 * 快；末退避 24s 又给持续性故障留出恢复时间。maxAgentDelayMs 保持 pi-ai 默认 60s
 * （本序列最大单次 24s，封顶不生效，只给环境变量调大 baseDelayMs 时兜底）。
 *
 * 注：pi-ai 的退避是纯指数、无抖动字段（可配字段只有 enabled/maxRetries/baseDelayMs/
 * maxAgentDelayMs），在可配范围内选参意味着放弃抖动——单用户 sidecar 的并发重试风暴
 * 风险低（同一时刻通常只有一个会话在生成），接受该取舍，不做 pi-ai patch。
 */
export const HARNESS_RETRY_POLICY = Object.freeze({
  enabled: true,
  maxRetries: 5,
  baseDelayMs: 1500,
  maxAgentDelayMs: 60_000,
});

function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 重试预算的活配置：环境变量逐字段覆盖，坏值一律回退默认（对齐 requestBudgetThresholds）。 */
export function harnessRetryPolicy(environment = process.env) {
  const env = environment ?? {};
  const enabled = String(env.MILKSU_PI_RETRY_ENABLED ?? "").trim() === "0"
    ? false
    : HARNESS_RETRY_POLICY.enabled;
  return {
    enabled,
    maxRetries: positiveInt(env.MILKSU_PI_RETRY_MAX_RETRIES, HARNESS_RETRY_POLICY.maxRetries),
    baseDelayMs: positiveInt(env.MILKSU_PI_RETRY_BASE_DELAY_MS, HARNESS_RETRY_POLICY.baseDelayMs),
    maxAgentDelayMs: positiveInt(env.MILKSU_PI_RETRY_MAX_DELAY_MS, HARNESS_RETRY_POLICY.maxAgentDelayMs),
  };
}

// ---------- 看门狗阈值 ----------

/** 软阈值到点只发事件（「连接无响应 x 秒」），不杀流；默认 90s。 */
export const HARNESS_STREAM_WATCHDOG_SOFT_MS = 90_000;
/** 硬阈值到点 abort 流并抛可重试错误（引擎原生重试接管）；默认 180s。 */
export const HARNESS_STREAM_WATCHDOG_HARD_MS = 180_000;

/**
 * 阈值集中读取（导出常量 + 环境变量覆盖，硬阈值必须可配是 R1a 的硬要求）。
 * hard < soft 的坏组合会失掉「先告警后判死」次序，clamp 到 hard = soft。
 */
export function harnessStreamWatchdogThresholds(environment = process.env) {
  const env = environment ?? {};
  const softMs = positiveInt(env.MILKSU_PI_STREAM_WATCHDOG_SOFT_MS, HARNESS_STREAM_WATCHDOG_SOFT_MS);
  const hardMs = Math.max(softMs, positiveInt(
    env.MILKSU_PI_STREAM_WATCHDOG_HARD_MS,
    HARNESS_STREAM_WATCHDOG_HARD_MS,
  ));
  return { softMs, hardMs };
}

// ---------- 错误分类标记（密钥/欠费/权限 ⇒ 不重试；网络/限流 ⇒ 确保可重试） ----------

/** 模式表 → 大小写不敏感的正则（对齐 pi-ai retry.js buildProviderErrorPattern 的做法）。 */
function buildProviderErrorPattern(patterns) {
  return new RegExp(patterns.join("|"), "i");
}

/** 密钥无效/欠费/权限类：重试烧时间烧额度，必须直报。 */
const FATAL_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  // 密钥无效/缺失/过期/吊销（含各家拼写）。
  "(?:invalid|incorrect|missing|expired|revoked)[^\\n]{0,48}api[ _-]?key",
  "api[ _-]?key[^\\n]{0,48}(?:invalid|incorrect|not[ _-]?valid|missing|expired|revoked)",
  "authentication[ _-]?error",
  "\\bunauthorized\\b",
  "\\b401\\b",
  // 权限/封禁类。
  "\\bforbidden\\b",
  "permission[ _-]?denied",
  "access[ _-]?denied",
  "\\b403\\b",
  "account[ _-]?(?:suspended|disabled)",
  // 欠费/配额耗尽类（pi-ai 的 NON_RETRYABLE 表已认一部分，这里补齐常见网关文案）。
  "insufficient[ _-]?quota",
  "quota[ _-]?(?:exceeded|exhausted)",
  "out of budget",
  "billing",
  "available balance",
  "payment[ _-]?required",
  "\\b402\\b",
  "subscription_sharing_usage_limit_exceeded",
  "monthly usage limit",
]);

/**
 * 节流类文案优先于 fatal 判定：OpenAI 的「Rate limit reached … increase your quota」
 * 带 quota 字样但是限流（429），不是欠费；把它标成 fatal 会把可自愈的限流判死。
 */
const THROTTLE_OVERRIDE_PATTERN = buildProviderErrorPattern([
  "rate.?limit",
  "too many requests",
  "\\b429\\b",
  "overloaded",
  "server.?busy",
  "high demand",
  "at capacity",
  "service.?unavailable",
  "server.?unavailable",
  "(?:try|retry) (?:your|the) request",
  "\\b5\\d\\d\\b",
]);

/** 网络/服务端瞬时故障类：这些该重试（对齐 bridge 模型源分类的 unavailable 档）。 */
const TRANSIENT_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  "\\b408\\b",
  "\\b429\\b",
  "rate.?limit",
  "timeout",
  "timed.?out",
  "temporar",
  "network",
  "fetch failed",
  "econn",
  "etimedout",
  "enotfound",
  "eai_again",
  "socket hang up",
  "connection",
  "terminated",
  "ended without",
  "stream ended before",
  "unavailable",
  "overloaded",
  "\\b5\\d\\d\\b",
]);

/** fatal 标记含 "billing"：pi-ai NON_RETRYABLE 表必中 ⇒ isRetryableAssistantError 必 false。 */
const FATAL_ERROR_MARKER = " [MilkSU: fatal provider error (billing/auth/permission class), not retryable]";
/** transient 标记含 "network error"：pi-ai RETRYABLE 表必中 ⇒ isRetryableAssistantError 必 true。 */
const TRANSIENT_ERROR_MARKER = " [MilkSU: transient network error, safe to retry]";
const MARKER_SIGIL = "[MilkSU:";

function isRetryableErrorMessage(message) {
  return isRetryableAssistantError({ stopReason: "error", errorMessage: message });
}

/**
 * 错误文案分类："fatal"（密钥/欠费/权限）| "transient"（网络/限流/5xx）| ""（未知，
 * 交给 pi-ai 默认判定——未知默认不可重试，除非文案本身命中 pi-ai 的 RETRYABLE 表）。
 */
export function classifyProviderErrorText(text) {
  const message = String(text ?? "");
  if (!message.trim()) return "";
  if (FATAL_PROVIDER_ERROR_PATTERN.test(message) && !THROTTLE_OVERRIDE_PATTERN.test(message)) {
    return "fatal";
  }
  if (TRANSIENT_PROVIDER_ERROR_PATTERN.test(message)) return "transient";
  return "";
}

/**
 * 在 provider 层给错误文案追加分类标记（幂等）。只做**翻边**，不做冗余标记：
 *   - fatal 且 pi-ai 本来就会重试（如 "Provider returned error: 401 …"）⇒ 追加 fatal
 *     标记翻成不可重试；
 *   - transient 且 pi-ai 本来不会重试（如裸 "ECONNRESET"）⇒ 追加 transient 标记翻成
 *     可重试；
 *   - 已是目标分类的文案原样返回（分类结果不变，文案不加噪音）。
 */
export function markProviderErrorMessage(text) {
  const message = String(text ?? "");
  if (!message.trim() || message.includes(MARKER_SIGIL)) return message;
  const kind = classifyProviderErrorText(message);
  if (kind === "fatal" && isRetryableErrorMessage(message)) {
    return message + FATAL_ERROR_MARKER;
  }
  if (kind === "transient" && !isRetryableErrorMessage(message)) {
    return message + TRANSIENT_ERROR_MARKER;
  }
  return message;
}

// ---------- 挂死看门狗守卫 ----------

/**
 * 硬判死时抛出的错误。文案保留 "timed out"（pi-ai RETRYABLE 表的 timed.?out 必中），
 * 且不含任何 NON_RETRYABLE 表词——这样引擎 classify 的 isRetryableAssistantError
 * 必判可重试，原生重试接管。对齐老引擎 RequestBudgetError 的做法。
 */
export class StreamWatchdogTimeoutError extends Error {
  constructor({ stage, softMs, hardMs }) {
    const seconds = ms => `${Math.round(ms / 1000)}s`;
    super(stage === "ttfb"
      ? `Model request timed out before the first byte: no response within ${seconds(hardMs)} `
        + `(stream watchdog soft ${seconds(softMs)} / hard ${seconds(hardMs)}); `
        + "the connection was dropped so the engine can retry."
      : `Model stream timed out: no data for ${seconds(hardMs)} since the last event `
        + `(stream watchdog soft ${seconds(softMs)} / hard ${seconds(hardMs)}); `
        + "the connection was dropped so the engine can retry.");
    this.name = "StreamWatchdogTimeoutError";
    this.stage = stage;
    this.softMs = softMs;
    this.hardMs = hardMs;
  }
}

function combineSignals(...signals) {
  const present = signals.filter(Boolean);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(present);
  const controller = new AbortController();
  const forward = signal => controller.abort(signal.reason);
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => forward(signal), { once: true });
  }
  return controller.signal;
}

/**
 * 一条流式请求的看门狗（对齐 bridge-request-budget.js createRequestBudgetGuard 的
 * 语义，阈值平面化）：
 *   - `signal` 交给下游请求（parentSignal 与判死 controller 合成）；硬阈值到点用
 *     StreamWatchdogTimeoutError abort。
 *   - `note()` 每收到一个事件调用：首个事件把阶段从 ttfb 切到 stream，并重置软/硬
 *     闹钟——有进展就不是死。
 *   - `onStall({ stage, softMs, hardMs })` 软阈值到点触发一次（软阈值之后又有事件则
 *     复位，可再次触发）：只报告「连接无响应」，不杀。
 *   - `onExpire(error)` 硬阈值到点同步触发：调用方应立即把错误事件推进外层流（不等
 *     SDK 对 abort 的反应——真挂死的 socket 可能对 abort 装死）。
 *   - `stop()` 必须放 finally：成功/失败/判死都不能留定时器。
 */
export function createStreamWatchdogGuard({
  thresholds,
  parentSignal,
  timerApi = { setTimeout, clearTimeout },
  onStall,
  onExpire,
} = {}) {
  const limits = typeof thresholds === "function" ? thresholds() : thresholds;
  const softMs = positiveInt(limits?.softMs, HARNESS_STREAM_WATCHDOG_SOFT_MS);
  const hardMs = Math.max(softMs, positiveInt(limits?.hardMs, HARNESS_STREAM_WATCHDOG_HARD_MS));
  const controller = new AbortController();
  const signal = combineSignals(parentSignal, controller.signal);
  let stage = "ttfb";
  let stalled = false;
  let stallTimer = null;
  let killTimer = null;

  const clearStall = () => {
    if (stallTimer !== null) {
      timerApi.clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const clearKill = () => {
    if (killTimer !== null) {
      timerApi.clearTimeout(killTimer);
      killTimer = null;
    }
  };

  const expire = () => {
    killTimer = null;
    if (controller.signal.aborted) return;
    const error = new StreamWatchdogTimeoutError({ stage, softMs, hardMs });
    try {
      onExpire?.(error);
    } catch {
      /* 观测回调不能挡住判死 */
    }
    controller.abort(error);
  };

  const reportStall = () => {
    stallTimer = null;
    stalled = true;
    try {
      onStall?.({ stage, softMs, hardMs });
    } catch {
      /* 观测回调不能挡住告警 */
    }
    // 软告警之后武装硬闹钟；宽限里来了新事件，note() 会把它换掉。
    clearKill();
    killTimer = timerApi.setTimeout(expire, Math.max(1, hardMs - softMs));
  };

  stallTimer = timerApi.setTimeout(reportStall, softMs);

  return {
    signal,
    get stage() {
      return stage;
    },
    get stalled() {
      return stalled;
    },
    note() {
      stage = "stream";
      clearStall();
      clearKill();
      stalled = false;
      stallTimer = timerApi.setTimeout(reportStall, softMs);
    },
    stop() {
      clearStall();
      clearKill();
    },
    timeoutError() {
      return controller.signal.reason instanceof StreamWatchdogTimeoutError
        ? controller.signal.reason
        : null;
    },
  };
}

// ---------- 流包装 ----------

const ZERO_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
});

/** 把失败包成 pi 协议的 error 事件（`error` 是一个 assistant 消息对象，usage 必须在场：pi-durable recordUsage 对缺 usage 的消息会算坏账）。 */
function streamErrorEvent(error, base, model) {
  const source = base && typeof base === "object" ? base : {};
  const message = error instanceof Error ? error.message : String(error ?? "Model request failed");
  return {
    type: "error",
    reason: "error",
    error: {
      ...source,
      role: "assistant",
      content: Array.isArray(source.content) ? source.content : [],
      api: source.api ?? model?.api,
      provider: source.provider ?? model?.provider,
      model: source.model ?? model?.id,
      usage: source.usage ?? ZERO_USAGE,
      stopReason: "error",
      errorMessage: markProviderErrorMessage(message),
    },
  };
}

/**
 * 事件翻译：看门狗判死 ⇒ 无论内层给的是 error 还是 aborted（SDK 对 abort 的标准反应
 * 是 stopReason "aborted"，引擎不重试 aborted），都换成带 "timed out" 的可重试 error；
 * 父信号取消（用户中止）⇒ 原样透传；其余 error ⇒ 追加分类标记。done/进度事件透传。
 */
function translateStreamEvent(event, guard, model) {
  if (event?.type !== "error") return event;
  const timeout = guard.timeoutError();
  if (timeout) return streamErrorEvent(timeout, event.error, model);
  if (event.reason === "aborted") return event;
  const errorMessage = String(event.error?.errorMessage ?? "");
  if (!errorMessage) return event;
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: markProviderErrorMessage(errorMessage),
    },
  };
}

/**
 * 给一次模型流式请求套看门狗。`open(model, context, options)` 返回内层流（pi-ai 的
 * AssistantMessageEventStream 惰性流）；返回外层同协议流。
 *   - 每个内层事件 note() 续命并翻译后透传；
 *   - 硬判死：onExpire 同步把可重试错误事件推进外层流（不等 SDK 反应），随后 abort
 *     内层请求；
 *   - 内层抛错（没有 error 事件的失败）：同样翻译成（看门狗或原样的）error 事件；
 *   - `onStall` 软阈值回调带上 options.sessionId（pi-durable 每会话稳定的
 *     pi.provider sessionId，会话层据此把事件归到对应桌面会话）。
 *   - `onEvent`（R1b 状态可见性）：每个翻译后的事件**只读**转发给观察者（带上
 *     sessionId/provider/modelId 归因信息）。流式旁路从这里拿原始 delta，先 push
 *     给引擎再通知，观察者抛错被吞掉，绝不影响流本体。
 *   - `tappedEvents`（R1b 双层包装去重）：同一集合内的嵌套包装（milksu-route 的
 *     openSource 走本集合 streamSimple，外层 route 流与内层来源流都被包）会让同一
 *     事件对象流经两层 tap；按对象身份去重——内层先 tap（事件从内层产生），外层
 *     遇到已 tap 的对象静默跳过，否则旁路会把每个 delta 双发到桌面。
 */
export function watchdoggedModelStream({
  open,
  model,
  context,
  options,
  thresholds,
  timerApi,
  onStall,
  onEvent,
  tappedEvents,
}) {
  const outer = new AssistantMessageEventStream();
  const guard = createStreamWatchdogGuard({
    thresholds,
    parentSignal: options?.signal,
    timerApi,
    onStall: info => {
      try {
        onStall?.({
          ...info,
          sessionId: options?.sessionId,
          provider: model?.provider,
          modelId: model?.id,
        });
      } catch {
        /* 观测回调不能挡住流 */
      }
    },
    onExpire: error => {
      outer.push(streamErrorEvent(error, undefined, model));
      outer.end();
    },
  });
  let inner;
  try {
    inner = open(model, context, { ...(options ?? {}), signal: guard.signal });
  } catch (error) {
    guard.stop();
    throw error;
  }
  void (async () => {
    try {
      for await (const event of inner) {
        guard.note();
        const translated = translateStreamEvent(event, guard, model);
        outer.push(translated);
        notifyStreamTap(onEvent, translated, options, model, tappedEvents);
      }
      outer.end();
    } catch (error) {
      outer.push(streamErrorEvent(guard.timeoutError() ?? error, undefined, model));
      outer.end();
    } finally {
      guard.stop();
    }
  })();
  return outer;
}

/**
 * R1b 流式旁路的只读通知：把翻译后的事件连同归因信息（options.sessionId =
 * pi-durable 每会话稳定的 pi.provider sessionId；provider/modelId 来自请求的模型）
 * 交给观察者。观察者抛错/观察者缺失都不影响流（红线：旁路挂了不能影响引擎本体）。
 *
 * `tappedEvents`（同一集合的 WeakSet）在场时按事件对象身份去重：milksu-route 的
 * openSource 闭包走同一集合的包装 streamSimple，内层来源流与外层 route 流是嵌套的
 * 两层包装，同一事件对象会流经两层（translateStreamEvent 对非 error 事件原样透传
 * 同一引用，createModelSourceStream/lazyStream 逐引用转发）；内层先 tap、外层跳过，
 * 旁路才不会把 delta 双发。缺位（裸用 watchdoggedModelStream 的调用方）不去重。
 */
function notifyStreamTap(onEvent, event, options, model, tappedEvents) {
  if (typeof onEvent !== "function") return;
  if (tappedEvents !== undefined && typeof event === "object" && event !== null) {
    if (tappedEvents.has(event)) return;
    tappedEvents.add(event);
  }
  try {
    onEvent({
      event,
      sessionId: options?.sessionId,
      provider: model?.provider,
      modelId: model?.id,
    });
  } catch {
    // 观测回调不能挡住流。
  }
}

/**
 * 给 pi-ai Models 集合（createHarnessModels 的 { models, … } 包装面）的 streamSimple/
 * stream 套看门狗，其余方法原样委托。这是 provider 层的单一收口：ModelsImpl.streamSimple
 * 经 applyAuth 分发到 setProvider 注册的 provider，在这里包一层即可覆盖账号/自有/
 * milksu-route 三条产品路径（route 的 openSource 也走本集合的 streamSimple，内层来源
 * 流同样被看住），也覆盖测试预注册的 faux provider——无需逐注册点包 provider 实例。
 *
 * 实现用原型委托（Object.create(models) + 覆写两个方法）：ModelsImpl 的字段全在构造
 * 器里初始化、方法只改 Map 不写字段（models.js 实证），委托链上读写一致；比手工复制
 * 全方法面安全（不会漏接口）。
 */
export function withStreamWatchdogCollection(collection, options = {}) {
  const models = collection?.models;
  if (!models || typeof models.streamSimple !== "function" || typeof models.stream !== "function") {
    return collection;
  }
  const resolveThresholds = () => (
    typeof options.thresholds === "function"
      ? options.thresholds()
      : options.thresholds ?? harnessStreamWatchdogThresholds()
  );
  // R1b 双层包装去重：route 的 openSource 走本集合 streamSimple，同一事件对象会
  // 流经内层来源流与外层 route 流两层包装的 tap；按身份只 tap 一次（见
  // notifyStreamTap）。整个集合一份，内层与外层共享同一判定。
  const tappedEvents = new WeakSet();
  const wrap = open => (model, context, streamOptions) => watchdoggedModelStream({
    open,
    model,
    context,
    options: streamOptions,
    thresholds: resolveThresholds(),
    timerApi: options.timerApi,
    onStall: options.onStall,
    onEvent: options.onEvent,
    tappedEvents,
  });
  const watched = Object.create(models);
  watched.streamSimple = wrap(models.streamSimple.bind(models));
  watched.stream = wrap(models.stream.bind(models));
  return { ...collection, models: watched };
}
