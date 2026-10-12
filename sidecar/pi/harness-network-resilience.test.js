// R1a 网络韧性单元测试：重试策略/退避序列、看门狗阈值与守卫、错误分类表（可重试/
// 不可重试逐一断言）、流包装（判死翻译/标记/透传）、模型集合包装（委托+覆盖）。
//
// 中文断言一律写 \uXXXX 转义（esbuild 转义非 ASCII 的坑，见 B2f）。守卫用注入的
// 小阈值 + 真定时器（毫秒级、余量放宽），不造假时钟。

import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableAssistantError, retryDelayMs } from "@earendil-works/pi-ai/utils/retry";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
  HARNESS_RETRY_POLICY,
  HARNESS_STREAM_WATCHDOG_HARD_MS,
  HARNESS_STREAM_WATCHDOG_SOFT_MS,
  StreamWatchdogTimeoutError,
  classifyProviderErrorText,
  createStreamWatchdogGuard,
  harnessRetryPolicy,
  harnessStreamWatchdogThresholds,
  markProviderErrorMessage,
  watchdoggedModelStream,
  withStreamWatchdogCollection,
} from "./harness-network-resilience.js";
import { createHarnessModels } from "./harness-model-providers.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- 重试策略 ----------

test("harnessRetryPolicy defaults to the 5-retry budget", () => {
  assert.deepEqual(harnessRetryPolicy({}), {
    enabled: true,
    maxRetries: 5,
    baseDelayMs: 1500,
    maxAgentDelayMs: 60000,
  });
  assert.deepEqual(HARNESS_RETRY_POLICY, harnessRetryPolicy({}));
});

test("harnessRetryPolicy reads per-field env overrides and falls back on bad values", () => {
  assert.deepEqual(harnessRetryPolicy({
    MILKSU_PI_RETRY_MAX_RETRIES: "3",
    MILKSU_PI_RETRY_BASE_DELAY_MS: "250",
    MILKSU_PI_RETRY_MAX_DELAY_MS: "5000",
  }), {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 250,
    maxAgentDelayMs: 5000,
  });
  // "0" 是唯一的关拼写（对齐 MILKSU_PI_HARNESS 的门约定）；坏值回退默认。
  assert.equal(harnessRetryPolicy({ MILKSU_PI_RETRY_ENABLED: "0" }).enabled, false);
  assert.equal(harnessRetryPolicy({ MILKSU_PI_RETRY_ENABLED: "1" }).enabled, true);
  assert.deepEqual(harnessRetryPolicy({
    MILKSU_PI_RETRY_MAX_RETRIES: "x",
    MILKSU_PI_RETRY_BASE_DELAY_MS: "-5",
    MILKSU_PI_RETRY_MAX_DELAY_MS: "",
  }), harnessRetryPolicy({}));
});

test("retry budget yields the specified backoff sequence (5 retries, ~46.5s total)", () => {
  const policy = harnessRetryPolicy({});
  const delays = [1, 2, 3, 4, 5].map(attempt => retryDelayMs(policy, attempt));
  // pi-ai retryDelayMs：baseDelayMs × 2^(n-1)，封顶 maxAgentDelayMs。
  assert.deepEqual(delays, [1500, 3000, 6000, 12000, 24000]);
  assert.equal(delays.reduce((sum, value) => sum + value, 0), 46500);
  // 封顶生效路径：maxAgentDelayMs 5000 时不越顶。
  const capped = { ...policy, maxAgentDelayMs: 5000 };
  assert.deepEqual([1, 2, 3, 4, 5].map(n => retryDelayMs(capped, n)), [1500, 3000, 5000, 5000, 5000]);
});

// ---------- 看门狗阈值 ----------

test("watchdog thresholds default to soft 90s / hard 180s and read env overrides", () => {
  assert.deepEqual(harnessStreamWatchdogThresholds({}), { softMs: 90000, hardMs: 180000 });
  assert.equal(HARNESS_STREAM_WATCHDOG_SOFT_MS, 90000);
  assert.equal(HARNESS_STREAM_WATCHDOG_HARD_MS, 180000);
  assert.deepEqual(harnessStreamWatchdogThresholds({
    MILKSU_PI_STREAM_WATCHDOG_SOFT_MS: "1000",
    MILKSU_PI_STREAM_WATCHDOG_HARD_MS: "2000",
  }), { softMs: 1000, hardMs: 2000 });
  // hard < soft 会失掉「先告警后判死」次序：clamp 到 hard = soft；坏值回退默认。
  assert.deepEqual(harnessStreamWatchdogThresholds({
    MILKSU_PI_STREAM_WATCHDOG_SOFT_MS: "5000",
    MILKSU_PI_STREAM_WATCHDOG_HARD_MS: "2000",
  }), { softMs: 5000, hardMs: 5000 });
  assert.deepEqual(harnessStreamWatchdogThresholds({
    MILKSU_PI_STREAM_WATCHDOG_SOFT_MS: "nope",
    MILKSU_PI_STREAM_WATCHDOG_HARD_MS: "0",
  }), { softMs: 90000, hardMs: 180000 });
});

// ---------- 错误分类表（可重试/不可重试逐一断言） ----------

/** 每行：[文案, 期望分类, 标记后 isRetryableAssistantError 的期望] */
const classificationTable = [
  // 网络/瞬时类：pi-ai 原生认的，不加标记也判可重试。
  ["TypeError: fetch failed", "transient", true],
  ["socket hang up", "transient", true],
  ["getaddrinfo ENOTFOUND api.example.com", "transient", true],
  ["Request timed out.", "transient", true],
  ["Anthropic stream ended before message_stop", "transient", true],
  ["503 Service Unavailable", "transient", true],
  ["OpenAI API error 429: rate limit exceeded", "transient", true],
  ["Provider returned error: 503 upstream overloaded", "transient", true],
  ["upstream connect error: connection idle timeout", "transient", true],
  // 网络/瞬时类：pi-ai 原生不认（重试表没这个词），追加标记翻成可重试。
  ["read ECONNRESET", "transient", true],
  ["upstream request terminated: no bytes", "transient", true],
  // 密钥/欠费/权限类：不可重试。
  ["Incorrect API key provided: sk-abc123", "fatal", false],
  ["Provider returned error: 401 Incorrect API key provided", "fatal", false],
  ["invalid_api_key: the API key was revoked", "fatal", false],
  ["authentication_error: missing authorization header", "fatal", false],
  ["403 Forbidden: permission denied for model access", "fatal", false],
  ["402 Payment Required: available balance is 0.00", "fatal", false],
  ["insufficient_quota: you exceeded your current quota", "fatal", false],
  ["subscription_sharing_usage_limit_exceeded", "fatal", false],
  ["Account is suspended for billing issues", "fatal", false],
  // 节流带 quota 字样的限流文案：节流覆盖 fatal 判定 → 仍可重试（不能把 429 判死）。
  ["Rate limit reached for requests. Increase your quota to continue.", "transient", true],
  ["429 Too Many Requests: quota will reset shortly", "transient", true],
  // 未知类：交给 pi-ai 默认（默认不可重试，除非文案本身命中重试表）。
  ["invalid_request_error: max_tokens is too large", "", false],
  ["model not found: no such model id", "", false],
  ["", "", false],
];

test("classification table: each provider error text maps to its retry verdict", () => {
  for (const [text, expectedKind, expectedRetryable] of classificationTable) {
    assert.equal(classifyProviderErrorText(text), expectedKind, `class of ${JSON.stringify(text)}`);
    const marked = markProviderErrorMessage(text);
    const verdict = isRetryableAssistantError({ stopReason: "error", errorMessage: marked });
    assert.equal(verdict, expectedRetryable, `retryable verdict of ${JSON.stringify(marked)}`);
  }
});

test("marking flips only the wrong-side verdicts and is idempotent", () => {
  // pi-ai 原生会重试的 fatal 文案 → 追加含 "billing" 的标记翻成不可重试（NON_RETRYABLE 表必中）。
  const flipped = markProviderErrorMessage("Provider returned error: 401 Incorrect API key");
  assert.match(flipped, /billing/);
  assert.equal(isRetryableAssistantError({ stopReason: "error", errorMessage: flipped }), false);
  // pi-ai 原生不重试的 fatal 文案：结果不变，不加噪。
  assert.equal(
    markProviderErrorMessage("Incorrect API key provided"),
    "Incorrect API key provided",
  );
  // pi-ai 原生重试的 transient 文案：不加标记。
  assert.equal(markProviderErrorMessage("TypeError: fetch failed"), "TypeError: fetch failed");
  // pi-ai 原生不重试的 transient 文案 → 追加含 "network error" 的标记翻成可重试
  //（裸 ECONNRESET 不在 pi-ai 的重试表里，必须升级；而 "upstream connect error"
  // 原生就命中 upstream.?connect，无需标记——只翻错边的判定）。
  const upgraded = markProviderErrorMessage("read ECONNRESET");
  assert.match(upgraded, /network error/);
  assert.equal(isRetryableAssistantError({ stopReason: "error", errorMessage: upgraded }), true);
  assert.equal(
    markProviderErrorMessage("upstream connect error: connection idle timeout"),
    "upstream connect error: connection idle timeout",
  );
  // 幂等：二次标记不再追加。
  assert.equal(markProviderErrorMessage(upgraded), upgraded);
});

test("watchdog timeout error messages are retryable by the engine's classifier", () => {
  for (const stage of ["ttfb", "stream"]) {
    const error = new StreamWatchdogTimeoutError({ stage, softMs: 90000, hardMs: 180000 });
    assert.match(error.message, /timed out/);
    const marked = markProviderErrorMessage(error.message);
    assert.equal(marked, error.message, "watchdog text needs no extra marker");
    assert.equal(
      isRetryableAssistantError({ stopReason: "error", errorMessage: marked }),
      true,
      `stage ${stage} must classify retryable`,
    );
  }
});

// ---------- 看门狗守卫 ----------

test("guard reports the stall at the soft threshold and kills at the hard threshold", async () => {
  const stalls = [];
  const expires = [];
  const guard = createStreamWatchdogGuard({
    thresholds: { softMs: 60, hardMs: 140 },
    onStall: info => stalls.push(info),
    onExpire: error => expires.push(error),
  });
  assert.equal(guard.stage, "ttfb");
  await sleep(300);
  assert.equal(stalls.length, 1, "soft threshold fires once per stall episode");
  assert.equal(stalls[0].stage, "ttfb");
  assert.equal(stalls[0].softMs, 60);
  assert.equal(stalls[0].hardMs, 140);
  assert.ok(guard.stalled);
  assert.equal(expires.length, 1, "hard threshold kills after the grace");
  assert.ok(expires[0] instanceof StreamWatchdogTimeoutError);
  assert.ok(guard.signal.aborted);
  assert.equal(guard.timeoutError(), expires[0]);
  assert.match(expires[0].message, /timed out/);
  guard.stop();
});

test("guard resets both timers on every event and switches to the stream stage", async () => {
  const stalls = [];
  const expires = [];
  const guard = createStreamWatchdogGuard({
    thresholds: { softMs: 80, hardMs: 200 },
    onStall: info => stalls.push(info),
    onExpire: error => expires.push(error),
  });
  // 每 40ms 一个事件，持续 320ms：任何阶段都不该软告警/判死。
  for (let index = 0; index < 8; index += 1) {
    await sleep(40);
    guard.note();
  }
  assert.equal(guard.stage, "stream");
  assert.equal(stalls.length, 0);
  assert.equal(expires.length, 0);
  assert.equal(guard.signal.aborted, false);
  guard.stop();
});

test("guard clears the armed kill timer when progress resumes after a stall", async () => {
  const stalls = [];
  const expires = [];
  const guard = createStreamWatchdogGuard({
    thresholds: { softMs: 60, hardMs: 200 },
    onStall: info => stalls.push(info),
    onExpire: error => expires.push(error),
  });
  await sleep(100); // 软告警已触发（t≈60），硬闹钟已武装（原定 t≈200）。
  assert.equal(stalls.length, 1);
  await sleep(40);
  guard.note(); // t≈140 宽限内有进展：旧硬闹钟作废、stall 位复位。
  assert.equal(guard.stalled, false);
  // 越过原硬判死时刻（t≈200）：没有判死。继续静默是**新的**断流回合——软告警
  // 再次触发是正确行为（每段静默各告警一次），判死仍要等到新一轮硬阈值。
  await sleep(160);
  assert.equal(expires.length, 0, "progress after a stall must not be killed");
  assert.equal(stalls.length, 2, "a second silent episode reports a second stall");
  await sleep(80); // t≈380 > 新硬阈值 t≈320：这轮真的判死。
  assert.equal(expires.length, 1);
  guard.stop();
});

test("guard forwards the parent abort and does not translate it into a timeout", async () => {
  const parent = new AbortController();
  const guard = createStreamWatchdogGuard({
    thresholds: { softMs: 60, hardMs: 140 },
    parentSignal: parent.signal,
  });
  parent.abort(new Error("user cancelled"));
  assert.ok(guard.signal.aborted);
  assert.equal(guard.timeoutError(), null, "parent abort is not a watchdog kill");
  guard.stop();
});

test("guard.stop clears all timers", async () => {
  let stalls = 0;
  let expires = 0;
  const guard = createStreamWatchdogGuard({
    thresholds: { softMs: 50, hardMs: 100 },
    onStall: () => { stalls += 1; },
    onExpire: () => { expires += 1; },
  });
  guard.stop();
  await sleep(180);
  assert.equal(stalls, 0);
  assert.equal(expires, 0);
});

// ---------- 流包装 ----------

/** 受控内层流：事件数组（type: "push" 的项按值推进，"hang" 挂到判死）。 */
function scriptedInner(steps, hangPromise) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const step of steps) {
        if (step === "hang") {
          await hangPromise;
          return;
        }
        yield step;
      }
    },
  };
}

const never = new Promise(() => {});

const requestModel = { provider: "faux", modelId: undefined, id: "faux-1", api: "faux" };

test("watchdoggedModelStream kills a silent stream with a retryable engine error", async () => {
  const stalls = [];
  const stream = watchdoggedModelStream({
    open: () => scriptedInner(["hang"], never),
    model: requestModel,
    options: { sessionId: "session-1" },
    thresholds: { softMs: 50, hardMs: 120 },
    onStall: info => stalls.push(info),
  });
  const message = await stream.result();
  assert.equal(message.stopReason, "error");
  assert.match(message.errorMessage, /timed out/);
  assert.equal(
    isRetryableAssistantError({ stopReason: "error", errorMessage: message.errorMessage }),
    true,
  );
  // 错误消息形状：engine 记账（recordUsage）需要的字段都在场。
  assert.equal(message.role, "assistant");
  assert.deepEqual(message.content, []);
  assert.deepEqual(message.usage, {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });
  assert.equal(message.provider, "faux");
  // 软阈值回调带上会话身份（会话层据此归因）。
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].sessionId, "session-1");
  assert.equal(stalls[0].provider, "faux");
  assert.equal(stalls[0].modelId, "faux-1");
});

test("watchdoggedModelStream rewrites the SDK abort reaction of a watchdog kill", async () => {
  // SDK 对 abort 的标准反应是 stopReason "aborted"（引擎不重试 aborted）；判死必须翻成
  // 可重试的 error —— 对齐老引擎 passThrough 的语义。
  let killSignal;
  const inner = {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: {} };
      await never; // 看门狗在这里判死。
      killSignal = true;
      yield { type: "error", reason: "aborted", error: { stopReason: "aborted", errorMessage: "Request was aborted" } };
    },
  };
  const stream = watchdoggedModelStream({
    open: (model, context, options) => {
      assert.ok(options.signal, "guard signal replaces the request signal");
      return inner;
    },
    model: requestModel,
    thresholds: { softMs: 50, hardMs: 110 },
  });
  const message = await stream.result();
  assert.equal(message.stopReason, "error", "aborted reaction must be rewritten to error");
  assert.match(message.errorMessage, /timed out/);
  assert.equal(killSignal, undefined, "late inner event never reached the pump loop body");
});

test("watchdoggedModelStream passes user aborts and successes through untouched", async () => {
  const parent = new AbortController();
  const abortedMessage = { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Request was aborted", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const abortedStream = watchdoggedModelStream({
    open: () => scriptedInner([
      { type: "start", partial: {} },
      { type: "error", reason: "aborted", error: abortedMessage },
    ]),
    model: requestModel,
    options: { signal: parent.signal },
    thresholds: { softMs: 50, hardMs: 120 },
  });
  parent.abort();
  const aborted = await abortedStream.result();
  assert.equal(aborted.stopReason, "aborted");
  assert.equal(aborted.errorMessage, "Request was aborted");

  const doneMessage = fauxAssistantMessage("all good");
  const doneStream = watchdoggedModelStream({
    open: () => scriptedInner([{ type: "done", reason: "stop", message: doneMessage }]),
    model: requestModel,
    thresholds: { softMs: 50, hardMs: 120 },
  });
  assert.equal(await doneStream.result(), doneMessage);
});

test("watchdoggedModelStream marks fatal provider errors and upgrades transient ones", async () => {
  const cases = [
    {
      errorMessage: "Provider returned error: 401 Incorrect API key provided",
      expectMarked: true,
      expectRetryable: false,
    },
    {
      errorMessage: "read ECONNRESET",
      expectMarked: true,
      expectRetryable: true,
    },
    {
      errorMessage: "TypeError: fetch failed",
      expectMarked: false,
      expectRetryable: true,
    },
  ];
  for (const { errorMessage, expectMarked, expectRetryable } of cases) {
    const stream = watchdoggedModelStream({
      open: () => scriptedInner([{
        type: "error",
        reason: "error",
        error: { role: "assistant", content: [], stopReason: "error", errorMessage },
      }]),
      model: requestModel,
      thresholds: { softMs: 50, hardMs: 120 },
    });
    const message = await stream.result();
    assert.equal(message.stopReason, "error");
    if (expectMarked) assert.notEqual(message.errorMessage, errorMessage);
    else assert.equal(message.errorMessage, errorMessage);
    assert.equal(
      isRetryableAssistantError({ stopReason: "error", errorMessage: message.errorMessage }),
      expectRetryable,
      `verdict for ${JSON.stringify(message.errorMessage)}`,
    );
  }
});

test("watchdoggedModelStream translates inner throws into marked error events", async () => {
  const stream = watchdoggedModelStream({
    open: () => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("getaddrinfo ENOTFOUND api.example.com");
      },
    }),
    model: requestModel,
    thresholds: { softMs: 50, hardMs: 120 },
  });
  const message = await stream.result();
  assert.equal(message.stopReason, "error");
  assert.equal(
    isRetryableAssistantError({ stopReason: "error", errorMessage: message.errorMessage }),
    true,
  );
});

// ---------- 模型集合包装 ----------

test("withStreamWatchdogCollection wraps dispatch and delegates everything else", async () => {
  const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 128000, maxTokens: 16384 }] });
  faux.setResponses([
    async () => {
      await never; // 挂死：首字节前无限等待。
    },
    fauxAssistantMessage("recovered"),
  ]);
  const collection = createHarnessModels();
  collection.models.setProvider(faux.provider);
  const wrapped = withStreamWatchdogCollection(collection, {
    thresholds: { softMs: 50, hardMs: 120 },
  });
  const collection2 = createHarnessModels();
  void collection2;
  assert.equal(typeof wrapped.models.streamSimple, "function");
  assert.notEqual(wrapped.models.streamSimple, collection.models.streamSimple);
  // 委托面：register（raw 侧 setProvider）→ 代理侧 getProvider/getModel 可见。
  wrapped.register({ id: "relay-x", models: [{ id: "m" }] });
  assert.ok(wrapped.models.getProvider("relay-x"));
  assert.ok(wrapped.models.getModel("relay-x", "m"));

  // 分发面：代理 streamSimple 走到 faux（第 1 步挂死）→ 看门狗判死 → 可重试错误；
  // 引擎重试取第 2 步 → 正常完成。这是「挂死 → abort → 原生重试接管」的最小链路。
  const model = wrapped.models.getModel("faux", "faux-1");
  const first = await wrapped.models.streamSimple(model, { messages: [] }, {}).result();
  assert.equal(first.stopReason, "error");
  assert.match(first.errorMessage, /timed out/);
  const second = await wrapped.models.streamSimple(model, { messages: [] }, {}).result();
  assert.equal(second.stopReason, "stop");
  assert.equal(second.content[0].text, "recovered");
  assert.equal(faux.state.callCount, 2);
});

test("withStreamWatchdogCollection returns unexpected shapes unchanged", () => {
  const notACollection = { models: null };
  assert.equal(withStreamWatchdogCollection(notACollection, {}), notACollection);
  const bare = createModels();
  assert.equal(withStreamWatchdogCollection({ models: bare }, {}).models.getProvider("nope"), undefined);
});

// ---------- pi-ai 分类器对默认行为的交叉核对 ----------

test("unmarked unknown errors stay non-retryable under the engine classifier", () => {
  // pi-ai 的默认面：没命中重试表 ⇒ 不可重试。我们的包装不改写未知文案。
  for (const text of ["invalid_request_error: bad parameter", "model not found"]) {
    assert.equal(
      isRetryableAssistantError({ stopReason: "error", errorMessage: markProviderErrorMessage(text) }),
      false,
      text,
    );
  }
});
