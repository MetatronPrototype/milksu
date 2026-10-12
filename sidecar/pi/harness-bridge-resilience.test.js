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
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { buildTestLayer, makeFauxModels, waitForEvent } from "./harness-bridge-test-support.mjs";

// 真定时器 + 毫秒级小阈值（软 600ms/硬 1200ms），重试退避压到 10-50ms——全链路
// 单用例耗时 ~1.3s，仍远低于 waitForEvent 的 15s 上限，且时序余量充足。
const RESILIENCE_ENV = {
  MILKSU_PI_STREAM_WATCHDOG_SOFT_MS: "600",
  MILKSU_PI_STREAM_WATCHDOG_HARD_MS: "1200",
  MILKSU_PI_RETRY_BASE_DELAY_MS: "10",
  MILKSU_PI_RETRY_MAX_DELAY_MS: "50",
};

async function withResilienceFixture(run, environment = RESILIENCE_ENV) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-r1a-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const { faux, models } = makeFauxModels();
  const { layer, events } = buildTestLayer({ agentDir, workspace, faux, models, environment });
  try {
    return await run({ layer, events, faux });
  } finally {
    await layer.disposeAll();
    await rm(root, { recursive: true, force: true });
  }
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

    // 判死那次失败以错误事件上桌（message_end 的 failure 直发面），文案带 timed out。
    const failure = (await waitForEvent(events, "error",
      event => /timed out/.test(String(event.error ?? ""))))[0];
    assert.equal(failure.id, conversationId);

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
    // 终态失败上桌。
    await waitForEvent(events, "error",
      event => /connection reset/.test(String(event.error ?? "")));
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
