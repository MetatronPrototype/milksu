import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessEventProjector, toolExecutionDurationMs } from "./harness-events.js";

function assistantMessage(content, extra = {}) {
  return {
    role: "assistant",
    content: Array.isArray(content) ? content : [{ type: "text", text: content }],
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: {
      input: 11,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 18,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1790000000000,
    ...extra,
  };
}

function assistantEntry(message) {
  return { id: 42, kind: "pi.assistant", model: [message] };
}

function toolResultEntry({ toolCallId, toolName, text, isError, durationMs }) {
  return {
    id: 43,
    kind: "pi.tool-result",
    model: [{
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError: Boolean(isError),
      ...(durationMs === undefined ? {} : { durationMs }),
      timestamp: 1790000000000,
    }],
  };
}

test("run boundaries project to turn events", () => {
  const projector = createHarnessEventProjector();
  assert.deepEqual(projector.project({ type: "run_start", inputs: [3] }), [
    { type: "turn_started", data: {} },
  ]);
  assert.deepEqual(projector.project({ type: "run_end", inputs: [3] }), [
    { type: "turn_settled", data: {} },
  ]);
  // R1b 回合生命周期：pi-durable 的 turn = 一个 generation 任务（模型回合），
  // turn_active 给渲染器「回合还活着」的引擎侧信号源（run 是桌面回合边界）。
  assert.deepEqual(projector.project({ type: "turn_start" }), [
    { type: "turn_active", data: { phase: "start" } },
  ]);
  assert.deepEqual(projector.project({ type: "turn_end" }), [
    { type: "turn_active", data: { phase: "end" } },
  ]);
});

test("streamed text and thinking project to delta events and a single thinking_done", () => {
  const projector = createHarnessEventProjector();
  const events = [
    ...projector.project({ type: "message_start", message: assistantMessage([]) }),
    ...projector.project({
      type: "message_update",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      changes: [
        { type: "thinking_start", contentIndex: 0, block: { type: "thinking", thinking: "" } },
        { type: "thinking_delta", contentIndex: 0, delta: "hmm " },
        { type: "thinking_delta", contentIndex: 0, delta: "hmm" },
        { type: "text_start", contentIndex: 1, block: { type: "text", text: "" } },
        { type: "text_delta", contentIndex: 1, delta: "answer" },
      ],
    }),
    ...projector.project({
      type: "message_end",
      entry: assistantEntry(assistantMessage([
        { type: "thinking", thinking: "hmm hmm" },
        { type: "text", text: "answer" },
      ])),
    }),
  ];
  const types = events.map(event => event.type);
  assert.deepEqual(types, [
    "thinking_start",
    "thinking_delta",
    "thinking_delta",
    "text_delta",
    // pi-durable 无 thinking_end：由投影器在 message_end 合成一次（不与
    // projectAssistantMessageEnd 的补发重复）。
    "thinking_done",
    "message_done",
    "usage_recorded",
  ]);
  const thinkingDone = events.find(event => event.type === "thinking_done");
  assert.equal(thinkingDone.data.content, "hmm hmm");
  const messageDone = events.find(event => event.type === "message_done");
  assert.equal(messageDone.data.content, "answer");
  assert.equal(messageDone.data.reason, "stop");
});

test("unstreamed thinking is still surfaced once at message end", () => {
  const projector = createHarnessEventProjector();
  const events = [
    ...projector.project({ type: "message_start", message: assistantMessage([]) }),
    ...projector.project({
      type: "message_end",
      entry: assistantEntry(assistantMessage([
        { type: "thinking", thinking: "considered" },
        { type: "text", text: "final" },
      ])),
    }),
  ];
  const thinkingDone = events.filter(event => event.type === "thinking_done");
  assert.equal(thinkingDone.length, 1);
  assert.equal(thinkingDone[0].data.content, "considered");
});

test("tool call families project to tool_call_start/progress/end", async () => {
  const projector = createHarnessEventProjector();
  const start = projector.project({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assert.deepEqual(start, [{
    type: "tool_call_start",
    data: {
      toolCallId: "call-1",
      toolName: "bash",
      content: "{\"command\":\"ls\"}",
      module: "coding",
    },
  }]);

  const progress = projector.project({
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    output: { append: "running\n" },
  });
  assert.deepEqual(progress, [{
    type: "tool_call_progress",
    data: { toolCallId: "call-1", toolName: "bash", module: "coding" },
  }]);

  await new Promise(resolve => setTimeout(resolve, 5));
  const end = projector.project({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    entry: toolResultEntry({
      toolCallId: "call-1",
      toolName: "bash",
      text: "file-a\nfile-b",
      isError: false,
    }),
  });
  assert.equal(end[0].type, "tool_call_end");
  assert.equal(end[0].data.content, "file-a\nfile-b");
  assert.equal(end[0].data.isError, false);
  assert.ok(end[0].data.durationMs >= 0, "durationMs comes from the tracked start time");
  assert.deepEqual(projector.pendingTools(), []);

  // entry 缺席（任务 fault/orphaned）也必须收尾，content 为空串。
  const orphan = projector.project({
    type: "tool_execution_start",
    toolCallId: "call-2",
    toolName: "bash",
    args: {},
  });
  assert.equal(orphan[0].type, "tool_call_start");
  const orphanEnd = projector.project({
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "bash",
  });
  assert.equal(orphanEnd[0].type, "tool_call_end");
  assert.equal(orphanEnd[0].data.content, "");
  assert.equal(orphanEnd[0].data.isError, false);

  // pi-durable 1.1.0：entry 的 toolResult 消息带内核记录的单调时钟耗时，优先于
  // 投影器的 wall-clock 差值（不受事件传播延迟影响，且随转录持久化）。
  projector.project({
    type: "tool_execution_start",
    toolCallId: "call-3",
    toolName: "bash",
    args: {},
  });
  const recordedEnd = projector.project({
    type: "tool_execution_end",
    toolCallId: "call-3",
    toolName: "bash",
    entry: toolResultEntry({
      toolCallId: "call-3",
      toolName: "bash",
      text: "done",
      isError: false,
      durationMs: 4321,
    }),
  });
  assert.equal(recordedEnd[0].data.durationMs, 4321, "recorded durationMs wins over wall-clock");
});

test("toolExecutionDurationMs prefers the kernel-recorded value and falls back to wall-clock", () => {
  const startedAt = Date.now() - 250;
  assert.equal(toolExecutionDurationMs(4321, startedAt), 4321, "kernel value wins when present");
  const fallback = toolExecutionDurationMs(undefined, startedAt);
  assert.ok(fallback >= 250 && fallback < 400, `wall-clock fallback, got ${fallback}`);
  assert.ok(toolExecutionDurationMs(-1, startedAt) >= 250, "negative recorded value falls back");
  const nanFallback = toolExecutionDurationMs(Number.NaN, startedAt);
  assert.ok(nanFallback >= 250, `NaN falls back to wall-clock, got ${nanFallback}`);
  assert.equal(toolExecutionDurationMs(undefined, undefined), undefined, "no kernel value and no start time");
  assert.equal(toolExecutionDurationMs(0, undefined), 0, "zero is a valid recorded duration");
});

test("task_failed projects to an error event", () => {
  const projector = createHarnessEventProjector();
  const events = projector.project({
    type: "task_failed",
    taskId: 7,
    kind: "pi.tool",
    message: "executor crashed",
  });
  assert.deepEqual(events, [{
    type: "error",
    data: { error: "Task pi.tool 7 failed: executor crashed" },
  }]);
});

test("deferred families project to nothing in the minimal glue", () => {
  const projector = createHarnessEventProjector();
  for (const event of [
    { type: "snapshot", entries: [], tools: [], compactions: [], inbox: [], agent: {}, usage: {} },
    { type: "inbox_update", items: [{ id: 5, mode: "followUp" }] },
    { type: "submission", record: { id: 5, status: "queued" } },
    { type: "entry_appended", entry: { id: 1 } },
    { type: "agent_changed", agent: {} },
    { type: "usage_changed", usage: {} },
    { type: "compaction_start", taskId: 2, reason: "auto", blocking: true },
    { type: "compaction_end", taskId: 2, reason: "auto" },
    { type: "deferred_poll", pollAt: 1 },
    { type: "unknown_future_event" },
  ]) {
    assert.deepEqual(projector.project(event), [], `no projection for ${event.type}`);
  }
});

// R1a：引擎 durable 重试排程投影成 model_retry（「网络波动，重试中 x/N」）。
// 中文断言按仓库纪律写 \uXXXX 转义（esbuild 会转义非 ASCII，B2f 踩过的坑）。
test("auto_retry events project to model_retry notices", () => {
  const projector = createHarnessEventProjector({ retryMax: 5 });
  // attempt = 刚失败的尝试号 = 即将进行的重试序号：1/5、2/5 …
  assert.deepEqual(projector.project({ type: "auto_retry_start", attempt: 1, at: 123, errorMessage: "boom" }), [{
    type: "model_retry",
    data: {
      phase: "start",
      attempt: 1,
      maxRetries: 5,
      message: "\u7f51\u7edc\u6ce2\u52a8\uff0c\u91cd\u8bd5\u4e2d 1/5",
      messageEnglish: "Network trouble, retrying 1/5",
      errorMessage: "boom",
      retryAt: 123,
    },
  }]);
  assert.deepEqual(
    projector.project({ type: "auto_retry_start", attempt: 3, at: 9, errorMessage: "ECONNRESET" })[0].data,
    {
      phase: "start",
      attempt: 3,
      maxRetries: 5,
      message: "\u7f51\u7edc\u6ce2\u52a8\uff0c\u91cd\u8bd5\u4e2d 3/5",
      messageEnglish: "Network trouble, retrying 3/5",
      errorMessage: "ECONNRESET",
      retryAt: 9,
    },
  );
  assert.deepEqual(projector.project({ type: "auto_retry_end", attempt: 1 }), [{
    type: "model_retry",
    data: { phase: "end", attempt: 1 },
  }]);
  // 缺省 retryMax 用 HARNESS_RETRY_POLICY 预算（5）；坏 attempt 回退 1。
  const fallback = createHarnessEventProjector().project({ type: "auto_retry_start", attempt: "x" });
  assert.equal(fallback[0].data.attempt, 1);
  assert.equal(fallback[0].data.maxRetries, 5);
});

test("projectBatch keeps intra-batch order across families", () => {
  const projector = createHarnessEventProjector();
  const batch = [
    { type: "message_start", message: assistantMessage([]) },
    { type: "message_update", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, changes: [
      { type: "text_delta", contentIndex: 0, delta: "part " },
    ] },
    { type: "message_update", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 }, changes: [
      { type: "text_delta", contentIndex: 0, delta: "two" },
    ] },
    { type: "tool_execution_start", toolCallId: "c", toolName: "read", args: { path: "x" } },
    { type: "tool_execution_update", toolCallId: "c", toolName: "read" },
    { type: "tool_execution_end", toolCallId: "c", toolName: "read", entry: toolResultEntry({
      toolCallId: "c", toolName: "read", text: "ok", isError: false,
    }) },
    { type: "message_end", entry: assistantEntry(assistantMessage([
      { type: "text", text: "let me read it" },
      { type: "toolCall", name: "read", arguments: { path: "x" }, id: "c" },
    ], { stopReason: "toolUse" })) },
  ];
  const types = projector.projectBatch(batch).map(event => event.type);
  assert.deepEqual(types, [
    "text_delta",
    "text_delta",
    "tool_call_start",
    "tool_call_progress",
    "tool_call_end",
    // 有工具调用的 assistant 收尾 → message_segment_done（与 bridge 现状同形）。
    "message_segment_done",
    "usage_recorded",
  ]);
});

test("failed assistant message_end does not project an error (session layer is the single failure reporter)", () => {
  // R1c（β.191 真机复盘）：失败消息的 error 投影在 harness 路径摘除——会话层
  // handleHarnessEvent 的 message_end 分支持有重试排程窗口的真相（中间失败静默、
  // 最终失败一条），投影器双发会让 fatal 类错误桌上两条相同错误。这里锁住该边界：
  // 无论文案是否 deferrable，投影器都不再产出 error。
  const projector = createHarnessEventProjector();
  const fatal = projector.project({
    type: "message_end",
    entry: assistantEntry(assistantMessage([], {
      stopReason: "error",
      errorMessage: "Provider returned error: 401 Incorrect API key provided",
    })),
  });
  assert.equal(fatal.filter(event => event.type === "error").length, 0,
    "non-deferrable failures no longer emit from the projector");
  assert.equal(fatal.some(event => event.type === "usage_recorded"), true,
    "usage projection is unaffected");

  const transient = projector.project({
    type: "message_end",
    entry: assistantEntry(assistantMessage([], {
      stopReason: "error",
      errorMessage: "Connection error.",
    })),
  });
  assert.equal(transient.filter(event => event.type === "error").length, 0,
    "deferrable failures stay deferred in the projector");

  // task_failed（引擎调度器判死的 faulted/orphaned 任务）仍照常投影 error——那是
  // 任务级终态，没有重试窗口可言。
  const taskFailed = projector.project({
    type: "task_failed",
    taskId: 7,
    kind: "pi.tool",
    message: "executor crashed",
  });
  assert.deepEqual(taskFailed, [{
    type: "error",
    data: { error: "Task pi.tool 7 failed: executor crashed" },
  }]);
});

test("module and usage attribution flow through the options", () => {
  const ctf = createHarnessEventProjector({ module: "ctf", conversationId: "conv-1", provider: "milksu-account" });
  const events = ctf.project({
    type: "message_end",
    entry: assistantEntry(assistantMessage("done", { model: "deepseek/deepseek-v4-flash" })),
  });
  const usage = events.find(event => event.type === "usage_recorded");
  assert.equal(usage.data.module, "ctf");
  assert.equal(usage.data.usage.module, "ctf");
  assert.equal(usage.data.usage.provider, "milksu-account");
  assert.equal(usage.data.usage.inputTokens, 11);
  const toolStart = ctf.project({
    type: "tool_execution_start",
    toolCallId: "c",
    toolName: "bash",
    args: {},
  });
  assert.equal(toolStart[0].data.module, "ctf");
});
