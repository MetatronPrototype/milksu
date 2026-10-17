// R1a 网络韧性集成测试（门开 harness 全链路，faux provider，零网络零密钥，数据全在
// 临时目录）。验收三条主线：
//   1. 挂死 → 看门狗硬判死（可重试错误）→ 引擎原生重试接管 → 回合恢复成功；
//   2. 重试可见：auto_retry_* 经投影器变成 model_retry 事件（「网络波动，重试中
//      x/5」）真实到达 bridge emit 管线；软阈值 model_stall（「连接无响应 x 秒」）
//      归因到正确会话；
//   3. 密钥类 fatal 不重试（1 次调用直报失败）+ 重试预算耗尽的调用数上界。
//
// 中文断言按仓库纪律写 \uXXXX 转义（esbuild 转义非 ASCII，B2f 踩过的坑）。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:net";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { buildTestLayer, makeFauxModels, waitForEvent } from "./harness-bridge-test-support.mjs";
import { createHarnessModels } from "./harness-model-providers.js";

// 真定时器 + 毫秒级小阈值（软 600ms/硬 1200ms），重试退避压到 10-50ms——全链路
// 单用例耗时 ~1.3s，仍远低于 waitForEvent 的 15s 上限，且时序余量充足。
const RESILIENCE_ENV = {
  MILKSU_PI_STREAM_WATCHDOG_SOFT_MS: "600",
  MILKSU_PI_STREAM_WATCHDOG_HARD_MS: "1200",
  MILKSU_PI_RETRY_BASE_DELAY_MS: "10",
  MILKSU_PI_RETRY_MAX_DELAY_MS: "50",
};

async function withResilienceFixture(run, environment = RESILIENCE_ENV, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-r1a-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const { faux, models } = makeFauxModels();
  const { layer, events } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    environment,
    ...options,
  });
  try {
    return await run({ layer, events, faux });
  } finally {
    await layer.disposeAll();
    await rm(root, { recursive: true, force: true });
  }
}

/** 本地必拒端口：先占一个临时端口再关掉（等价真机的 127.0.0.1:9 死端点，零网络依赖）。 */
async function refusedLocalPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

/** 挂死步：永不返回（无任何字节——TTFB 阶段挂死，β.190 事故同款形态）。 */
function hangingStep() {
  return async () => new Promise(() => {});
}

test("hang is killed by the watchdog and the engine retry recovers the turn", async () => {
  await withResilienceFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-hang-retry";
    faux.setResponses([
      hangingStep(),
      fauxAssistantMessage("recovered answer"),
    ]);
    await layer.createSession({ ...goCommand, conversationId });
    await layer.sendMessage({ ...goCommand, conversationId, prompt: "hello" });
    await waitForEvent(events, "turn_settled");

    // 引擎真的重试了：首发 1 次（挂死判死）+ 重试 1 次（成功）。
    assert.equal(faux.state.callCount, 2, "first attempt killed, retry succeeded");

    // 软阈值告警先于判死到达，且归因到正确会话：连接无响应 1 秒（\uXXXX 断言）。
    const stall = (await waitForEvent(events, "model_stall"))[0];
    assert.equal(stall.id, conversationId);
    assert.equal(stall.stage, "ttfb");
    assert.equal(stall.message, "\u8fde\u63a5\u65e0\u54cd\u5e94 1 \u79d2");
    assert.equal(stall.hardKillSeconds, 1);
    assert.equal(stall.provider, "faux");
    assert.equal(stall.model, "faux-1");

    // 重试可见：判死 → auto_retry_start → model_retry「网络波动，重试中 1/5」。
    const retryStart = (await waitForEvent(events, "model_retry",
      event => event.phase === "start"))[0];
    assert.equal(retryStart.id, conversationId);
    assert.equal(retryStart.attempt, 1);
    assert.equal(retryStart.maxRetries, 5);
    assert.equal(retryStart.message, "\u7f51\u7edc\u6ce2\u52a8\uff0c\u91cd\u8bd5\u4e2d 1/5");
    assert.match(retryStart.errorMessage, /timed out/);
    // 退避结束（下一尝试开始）也投影：phase end。
    await waitForEvent(events, "model_retry", event => event.phase === "end");

    // R1c（β.191 真机复盘）：判死那次失败是**中间失败**——重试窗口内不上桌（窗口内
    // 只有横幅说话）；本用例的重试会成功救回回合，所以全程零 error 事件。
    assert.equal(events.filter(event => event.type === "error").length, 0,
      "a recovered turn surfaces no error: the intermediate failure is banner-only");

    // 回合最终有成功答复。
    const done = (await waitForEvent(events, "message_done"))[0];
    assert.equal(done.content, "recovered answer");
  });
});

test("fatal auth errors fail fast without any retry", async () => {
  await withResilienceFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-fatal-auth";
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        // OpenRouter 风格包装：pi-ai 原生会把 provider returned error 判成可重试；
        // provider 层的 fatal 标记必须把它翻成不可重试。
        errorMessage: "Provider returned error: 401 Incorrect API key provided",
      }),
    ]);
    await layer.createSession({ ...goCommand, conversationId });
    await layer.sendMessage({ ...goCommand, conversationId, prompt: "hello" });
    await waitForEvent(events, "turn_settled");

    assert.equal(faux.state.callCount, 1, "fatal auth errors must not be retried");
    assert.equal(events.filter(event => event.type === "model_retry").length, 0);
    // 失败上桌且文案带 fatal 标记（含 billing ⇒ pi-ai 分类必为不可重试）。
    const failure = (await waitForEvent(events, "error",
      event => /Incorrect API key/.test(String(event.error ?? ""))))[0];
    assert.match(failure.error, /billing/);
    // R1c：不可重试类错误立即**一条**错误（真机曾是会话层+投影器双发两条），零横幅。
    await waitForEvent(events, "turn_settled");
    const errors = events.filter(event => event.type === "error");
    assert.equal(errors.length, 1, "exactly one error for a fatal failure (no double emission)");
    assert.equal(events.findIndex(event => event.type === "error")
      < events.findIndex(event => event.type === "turn_settled"),
      true, "the fatal error reaches the table before the turn settles");
  });
});

test("retry budget bounds the call count and each retry is visible", async () => {
  const environment = {
    ...RESILIENCE_ENV,
    MILKSU_PI_RETRY_MAX_RETRIES: "2",
  };
  await withResilienceFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-exhaust";
    const failing = () => fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "network error: connection reset",
    });
    faux.setResponses([failing(), failing(), failing()]);
    await layer.createSession({ ...goCommand, conversationId });
    await layer.sendMessage({ ...goCommand, conversationId, prompt: "hello" });
    await waitForEvent(events, "turn_settled");

    // 1 次首发 + 2 次重试 = 3 次调用；预算耗尽后回合失败（不再烧额度）。
    assert.equal(faux.state.callCount, 3);
    const starts = events.filter(event => event.type === "model_retry" && event.phase === "start");
    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map(event => event.attempt), [1, 2]);
    // 预算来自活配置（env 覆盖到 2）：文案「重试中 x/2」。
    assert.equal(starts[0].maxRetries, 2);
    assert.equal(starts[0].message, "\u7f51\u7edc\u6ce2\u52a8\uff0c\u91cd\u8bd5\u4e2d 1/2");
    assert.equal(starts[1].message, "\u7f51\u7edc\u6ce2\u52a8\uff0c\u91cd\u8bd5\u4e2d 2/2");
    // 终态失败上桌（R1c：中间失败静默，最终失败恰好一条）。
    await waitForEvent(events, "error",
      event => /connection reset/.test(String(event.error ?? "")));
    await waitForEvent(events, "turn_settled");
    assert.equal(events.filter(event => event.type === "error").length, 1,
      "intermediate failures stay silent; only the final failure errors once");
  }, environment);
});

test("default watchdog thresholds in the session layer stay at the R1a spec values", async () => {
  // 慢速用例不做真实等待：只断言层接线的默认阈值读数（真机 90s/180s 的验收列在
  // 「待装机验收项」）。
  await withResilienceFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-normal";
    faux.setResponses([fauxAssistantMessage("plain answer")]);
    await layer.createSession({ ...goCommand, conversationId });
    await layer.sendMessage({ ...goCommand, conversationId, prompt: "hello" });
    await waitForEvent(events, "turn_settled");
    // 正常回合零打扰：无 stall、无 retry、一次调用。
    assert.equal(faux.state.callCount, 1);
    assert.equal(events.filter(event => event.type === "model_stall").length, 0);
    assert.equal(events.filter(event => event.type === "model_retry").length, 0);
  }, { MILKSU_PI_RETRY_BASE_DELAY_MS: "10" });
});

test("dead-endpoint failures surface the retry banner x/5 and stay silent until the final error (production registration path)", async () => {
  // β.191 真机复现的工程化收口（Bug A/B 集成验收）：用户把 provider 指向
  // 127.0.0.1:9（连接秒拒）实测，引擎按 1.5/3/6/12/24s 退避重试 5 次，但桌面只有
  // 6 条「Agent 运行失败」、横幅一次没弹。本用例用生产同款注册链（空 harness 集合
  // createHarnessModels + 回合自带 customProvider → wireHarnessModelSelection →
  // buildHarnessProvider → 看门狗包装集合，与 harness-bridge-visibility 的生产路径
  // 用例同一接法）+ 本地必拒端口（临时端口占位后关闭，零外部网络、零真实密钥）
  // 走全链路。断言三件事：
  //   1. 横幅事件链通：model_retry start 1..5 逐条上桌（attempt 单调、成对的 end）；
  //   2. 中间失败静默：前 5 次尝试零 error 事件（重试窗口内不上桌）；
  //   3. 最终失败恰一条：预算烧尽后一条 connection 类 error 收尾，晚于最后一次横幅。
  const deadPort = await refusedLocalPort();
  const environment = {
    ...RESILIENCE_ENV,
    MILKSU_PI_RETRY_MAX_RETRIES: "5",
  };
  await withResilienceFixture(async ({ layer, events }) => {
    const conversationId = "conv-dead-endpoint";
    const command = {
      ...goCommand,
      conversationId,
      provider: "custom-relay-dead",
      model: "dead-model-1",
      // supervisor.go customProviderTurnPayload 的同款形状（回合自带中继定义）。
      customProvider: {
        id: "custom-relay-dead",
        name: "Dead Endpoint Relay",
        key: "test-key-not-a-secret",
        baseUrl: `http://127.0.0.1:${deadPort}/v1`,
        api: "openai-completions",
      },
    };
    await layer.createSession(command);
    await layer.sendMessage({ ...command, prompt: "Reply with exactly OK." });
    await waitForEvent(events, "turn_settled", () => true, 30000);

    // 引擎真的烧完预算：1 次首发 + 5 次重试（faux 未注册，调用只能走死端点）。
    // （没有 faux 计数器可看：以事件面断言预算。）

    // 1. 横幅事件链：start 1..5 逐条上桌，attempt 单调递增，每条带预算与文案。
    const starts = events.filter(event => event.type === "model_retry" && event.phase === "start");
    assert.equal(starts.length, 5, "model_retry start x/5 all reach the table");
    assert.deepEqual(starts.map(event => event.attempt), [1, 2, 3, 4, 5]);
    assert.ok(starts.every(event => event.maxRetries === 5), "banner carries the live retry budget");
    assert.ok(starts.every(event => event.id === conversationId), "banner attributed to the session");
    assert.match(starts[0].message, /\u91cd\u8bd5\u4e2d 1\/5/);
    assert.match(starts[4].message, /\u91cd\u8bd5\u4e2d 5\/5/);
    // 成对的 end（退避结束）也上桌。
    const ends = events.filter(event => event.type === "model_retry" && event.phase === "end");
    assert.equal(ends.length, 5, "model_retry end x/5 all reach the table");

    // 2. 中间失败静默：每条 error 之前都必有未收尾的 start 横幅在桌上——即首条
    //    error 不得早于最后一条 start 的 end（预算未耗尽时不报错）。
    const firstErrorAt = events.findIndex(event => event.type === "error");
    const lastRetryEndAt = events.findIndex((event, index) =>
      event.type === "model_retry" && event.phase === "end"
      && !events.slice(index + 1).some(later => later.type === "model_retry"));
    assert.ok(firstErrorAt > lastRetryEndAt,
      "no error may arrive while retries are still scheduled (banner-only window)");

    // 3. 最终失败恰一条：连接类错误，且它是全回合唯一的 error。
    const errors = events.filter(event => event.type === "error");
    assert.equal(errors.length, 1,
      "exactly one error for the whole dead-endpoint turn (six intermediate failures stay silent)");
    assert.match(String(errors[0].error), /connection/i,
      "the final error carries the provider failure text");
    assert.equal(errors[0].id, conversationId);
  }, environment, {
    // 生产默认接线：空 harness 集合（无预注册 provider）+ 无 personal 预注册——
    // provider 只能从回合的 customProvider（turnProvider）注册进包装集合。
    modelsCollection: () => createHarnessModels(),
    personalModelFor: () => undefined,
  });
});
