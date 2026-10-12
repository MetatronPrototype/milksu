// R1b 引擎状态可见性集成测试（门开 harness 全链路，faux provider，零网络零密钥，
// 数据全在临时目录）。验收四条主线（对照 REALUSE-audit-20261012.md D2）：
//   1. 流式旁路实时：partial 落盘节流（settings.progress.partialIntervalMs）拉大到
//      5s 后，思考/正文 delta 仍先于 message_done（提交投影）上桌，证明旁路不等
//      落盘（治「诈尸」）；
//   2. 去重：默认 100ms 节流下，旁路与提交投影并存，joined delta 与原文逐字相等
//      （投影重复会被拼接出来），thinking_done/message_done 恰一份；
//   3. 降级：旁路 emit 抛错（注入故障面）不影响回合完成，全文经投影路径完整上桌；
//   4. 回合生命周期（turn_active）、崩溃恢复（harness_recovery，双层模拟崩溃重开）
//      与排队可见（message_queued）端到端断言。
//
// 中文断言按仓库纪律写 \uXXXX 转义（esbuild 转义非 ASCII，B2f 踩过的坑）。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { buildTestLayer, makeFauxModels, waitForEvent } from "./harness-bridge-test-support.mjs";

const THINKING_TEXT = "Let me carefully consider the question step by step before answering it.";
const ANSWER_TEXT = "Here is the considered answer, streamed live to the desktop client.";

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

/** 慢滴流 faux：tokensPerSecond 限速让 thinking/text delta 分多拍到达（~1.2s 流）。 */
function makeDrippingFauxModels(tokensPerSecond = 20) {
  const faux = fauxProvider({
    models: [{
      id: "faux-1",
      name: "Faux Model",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    }],
    tokensPerSecond,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

function thinkingAndTextResponse() {
  return fauxAssistantMessage([
    { type: "thinking", thinking: THINKING_TEXT },
    { type: "text", text: ANSWER_TEXT },
  ]);
}

async function withVisibilityFixture(run, {
  environment = {},
  harnessSettings = undefined,
  emitWrapper = undefined,
  makeModels = makeFauxModels,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-r1b-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const { faux, models } = makeModels();
  const { layer, events } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    environment,
    harnessSettings,
    emitWrapper,
  });
  try {
    return await run({ layer, events, faux, root, agentDir, workspace });
  } finally {
    await layer.disposeAll();
    await rm(root, { recursive: true, force: true });
  }
}

function joinedDeltas(events, type) {
  return events
    .filter(event => event.type === type)
    .map(event => String(event.delta ?? ""))
    .join("");
}

test("streaming bypass delivers deltas live without waiting for committed projections", async () => {
  // 节流拉大到 5s：流时长 ~1.2s < 5s，期间不会有任何 partial 落盘提交。
  // message_done 只能来自流结束后的 classify 提交。此设定下任何先于 message_done
  // 到达的 delta 都必然出自旁路（实时性证明，非时钟断言而是次序断言）。
  await withVisibilityFixture(async ({ layer, events, faux }) => {
    faux.setResponses([thinkingAndTextResponse()]);
    await layer.createSession({ ...goCommand, conversationId: "conv-live" });
    await layer.sendMessage({ ...goCommand, conversationId: "conv-live", prompt: "hello" });
    await waitForEvent(events, "message_done");

    const firstThinkingDelta = events.findIndex(event => event.type === "thinking_delta");
    const firstTextDelta = events.findIndex(event => event.type === "text_delta");
    const messageDone = events.findIndex(event => event.type === "message_done");
    assert.ok(firstThinkingDelta >= 0, "thinking deltas arrived at all");
    assert.ok(firstTextDelta >= 0, "text deltas arrived at all");
    assert.ok(messageDone >= 0, "message_done arrived");
    assert.ok(
      firstThinkingDelta < messageDone && firstTextDelta < messageDone,
      "bypass deltas beat the committed projection (message_done)",
    );

    // 全文经旁路无损到达，且无投影重复（5s 节流下投影面本就无 delta）。
    assert.equal(joinedDeltas(events, "thinking_delta"), THINKING_TEXT);
    assert.equal(joinedDeltas(events, "text_delta"), ANSWER_TEXT);
    assert.equal(events.filter(event => event.type === "message_done").length, 1);
    const done = events.find(event => event.type === "message_done");
    assert.equal(done.content, ANSWER_TEXT);
  }, { harnessSettings: { progress: { partialIntervalMs: 5000 } }, makeModels: () => makeDrippingFauxModels(20) });
});

test("with the default 100ms throttle the bypass wins and projections are deduped", async () => {
  // 默认节流（100ms）+ 慢滴流（~1.2s）：提交投影的 message_update 每拍都会产生
  // delta 事件；抑制失效的话 joined delta 会把全文拼两遍。thinking_done 由投影器
  // 在 message_end 合成（累计状态），恰好一份。
  await withVisibilityFixture(async ({ layer, events, faux }) => {
    faux.setResponses([thinkingAndTextResponse()]);
    await layer.createSession({ ...goCommand, conversationId: "conv-dedup" });
    await layer.sendMessage({ ...goCommand, conversationId: "conv-dedup", prompt: "hello" });
    await waitForEvent(events, "turn_settled");

    assert.equal(joinedDeltas(events, "thinking_delta"), THINKING_TEXT);
    assert.equal(joinedDeltas(events, "text_delta"), ANSWER_TEXT);
    assert.equal(events.filter(event => event.type === "thinking_start").length, 1,
      "exactly one thinking_start (bypass or projection, never both)");
    const thinkingDone = events.filter(event => event.type === "thinking_done");
    assert.equal(thinkingDone.length, 1);
    assert.equal(thinkingDone[0].content, THINKING_TEXT);
    const done = events.filter(event => event.type === "message_done");
    assert.equal(done.length, 1);
    assert.equal(done[0].content, ANSWER_TEXT);

    // 回合生命周期（第 2 项）：turn_active start/end 成对上桌（引擎侧模型回合信号）。
    const turnStarts = events.filter(event => event.type === "turn_active" && event.phase === "start");
    const turnEnds = events.filter(event => event.type === "turn_active" && event.phase === "end");
    assert.ok(turnStarts.length >= 1, "turn_active start projected");
    assert.ok(turnEnds.length >= 1, "turn_active end projected");
    assert.ok(events.findIndex(event => event.type === "turn_active") < events.findIndex(
      event => event.type === "message_done"), "turn_active precedes the turn's message_done");
  }, { makeModels: () => makeDrippingFauxModels(20) });
});

test("a throwing bypass emit degrades silently and the turn still completes", async () => {
  // 旁路投递面注入故障：第一条 thinking_delta 抛错（旁路先赢 thinking_start 后必然
  // 由旁路发出）。断言：回合照常完成（引擎零打扰、无重试）、thinking_done 全文合成
  // （投影器累计不受抑制影响）、message_done 全文兜底。降级路径的 delta 面是尽力而
  // 为：streamResponse 收尾时未提交的 pending partial 本就不落盘（pi-durable 设计，
  // outcome 之后不留陈旧 partial），所以 delta 可能缺尾巴；全文的正确性由
  // message_done/thinking_done 保证，这里断言 delta 为无重复的前缀。
  let bypassWonStart = false;
  let thrown = false;
  const emitWrapper = base => (conversationId, type, data) => {
    if (type === "thinking_start") {
      bypassWonStart = true;
    } else if (type === "thinking_delta" && !thrown && bypassWonStart) {
      thrown = true;
      throw new Error("injected bypass emit failure");
    }
    return base(conversationId, type, data);
  };
  await withVisibilityFixture(async ({ layer, events, faux }) => {
    faux.setResponses([thinkingAndTextResponse()]);
    await layer.createSession({ ...goCommand, conversationId: "conv-degrade" });
    await layer.sendMessage({ ...goCommand, conversationId: "conv-degrade", prompt: "hello" });
    await waitForEvent(events, "turn_settled");

    assert.ok(thrown, "the injected failure actually hit the bypass emit path");
    assert.equal(faux.state.callCount, 1, "engine unharmed: one call, no retry");
    // 降级后投影路径接管：delta 无重复（前缀语义），全文由收尾事件兜底。
    const thinkingJoined = joinedDeltas(events, "thinking_delta");
    const textJoined = joinedDeltas(events, "text_delta");
    assert.ok(thinkingJoined.length > 0, "projection resumed thinking deltas after the break");
    assert.ok(THINKING_TEXT.startsWith(thinkingJoined), "thinking deltas stay a clean prefix");
    assert.ok(textJoined.length > 0, "projection delivered text deltas");
    assert.ok(ANSWER_TEXT.startsWith(textJoined), "text deltas stay a clean prefix");
    const thinkingDone = events.filter(event => event.type === "thinking_done");
    assert.equal(thinkingDone.length, 1);
    assert.equal(thinkingDone[0].content, THINKING_TEXT);
    const done = events.filter(event => event.type === "message_done");
    assert.equal(done.length, 1);
    assert.equal(done[0].content, ANSWER_TEXT);
  }, { emitWrapper, makeModels: () => makeDrippingFauxModels(20) });
});

test("queued user messages become message_queued with a position", async () => {
  // 第 4 项排队可见：上一回合在飞（可释放闸门卡住），followUp 落库排队 →
  // message_queued {position,total,mode}；回合结束后边界收编排队消息，第二轮照常
  // 完成，收尾复查不再误报排队。
  await withVisibilityFixture(async ({ layer, events, faux }) => {
    let releaseFirst;
    const firstGate = new Promise(resolve => {
      releaseFirst = resolve;
    });
    faux.setResponses([
      async () => {
        await firstGate;
        return fauxAssistantMessage("first answer");
      },
      fauxAssistantMessage("second answer"),
    ]);
    const session = await layer.createSession({ ...goCommand, conversationId: "conv-queue" });
    const firstSend = layer.sendMessage({ ...goCommand, conversationId: "conv-queue", prompt: "first" });
    await waitForEvent(events, "turn_started");
    await session.followUp("queued while busy");
    const queued = (await waitForEvent(events, "message_queued"))[0];
    assert.equal(queued.id, "conv-queue");
    assert.equal(queued.position, 1);
    assert.equal(queued.total, 1);
    assert.equal(queued.mode, "followUp");
    assert.equal(queued.text, "queued while busy");
    assert.equal(queued.message, "\u6392\u961f\u4e2d\u7b2c 1 \u4f4d");

    releaseFirst();
    await firstSend;
    // 排队消息被边界收编为第二轮输入，两轮答复都完整上桌。
    const dones = (await waitForEvent(events, "message_done",
      event => event.content === "second answer"));
    assert.equal(dones.length, 1);
    await waitForEvent(events, "message_done", event => event.content === "first answer");
    // 收尾后排队面已清空：排队事件恰一条（无重复误报）。
    await waitForEvent(events, "turn_settled");
    assert.equal(events.filter(event => event.type === "message_queued").length, 1);
  }, { makeModels: () => makeDrippingFauxModels(25) });
});

test("crash recovery is visible and the orphaned run resumes to completion", async () => {
  // 第 3 项恢复可见：第一层把回合挂在流上后整体 dispose（进程级崩溃的可观测等价物
  // 时 durable 状态里 run 仍在飞行）；第二层重开同一存储，附着帧发现 run →
  // harness_recovery（ready 之后上桌）→ 新消息排队（message_queued）→ resume
  // 续跑孤儿回合 → 两轮全部完成。
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-r1b-recover-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  try {
    // 第一段：挂死流上的回合 + 进程收场（不 abort，disposeAll 只封存不撤回）。
    // 挂死步必须响应 abort 信号：harness.close() 的 seal 会 abort 在飞调用并 join
    // 它们（真崩溃是 SIGKILL 不等 join；进程内等价物是让挂死步随 abort 落定，否则
    // disposeAll 永远收不了场）。
    const hangUntilAborted = (context, streamOptions) => new Promise((resolve, reject) => {
      const signal = streamOptions?.signal;
      const abort = () => reject(signal?.reason ?? new Error("aborted"));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
    const first = makeFauxModels();
    const { layer: layer1, events: firstEvents } = buildTestLayer({
      agentDir,
      workspace,
      faux: first.faux,
      models: first.models,
    });
    first.faux.setResponses([hangUntilAborted]);
    await layer1.createSession({ ...goCommand, conversationId: "conv-recover" });
    // sendMessage 的 prompt 队列自带错误兜底（enqueueConversationPrompt 不外抛），
    // 挂死回合上直接 fire-and-forget，等 run_start 落定即可。
    void layer1.sendMessage({ ...goCommand, conversationId: "conv-recover", prompt: "work" });
    await waitForEvent(firstEvents, "turn_started");
    await layer1.disposeAll();

    // 第二段：重开同一存储（新进程的可观测等价物：新层、新 faux、同 agentDir）。
    const second = makeFauxModels();
    const { layer: layer2, events } = buildTestLayer({
      agentDir,
      workspace,
      faux: second.faux,
      models: second.models,
    });
    second.faux.setResponses([
      fauxAssistantMessage("resumed answer"),
      fauxAssistantMessage("follow-up answer"),
    ]);
    await layer2.createSession({ ...goCommand, conversationId: "conv-recover" });

    // 恢复横幅在 ready 之后上桌（早于 ready 的事件可能被桌面丢弃）。
    const recovery = (await waitForEvent(events, "harness_recovery"))[0];
    assert.equal(recovery.id, "conv-recover");
    assert.equal(recovery.message, "\u4ece\u65ad\u70b9\u6062\u590d\u4e2d");
    assert.ok(events.findIndex(event => event.type === "ready")
      < events.findIndex(event => event.type === "harness_recovery"),
    "harness_recovery lands after ready");

    // 新消息在孤儿回合后面排队（可见），随后引擎 resume 把两轮都跑完。
    await layer2.sendMessage({ ...goCommand, conversationId: "conv-recover", prompt: "continue" });
    await waitForEvent(events, "message_queued",
      event => event.text === "continue");
    await waitForEvent(events, "message_done", event => event.content === "resumed answer");
    await waitForEvent(events, "message_done", event => event.content === "follow-up answer");
    await waitForEvent(events, "turn_settled");
    await layer2.disposeAll();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
