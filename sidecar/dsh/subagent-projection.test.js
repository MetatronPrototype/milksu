import assert from "node:assert/strict";
import test from "node:test";
import {
  acpToolContentText,
  applyDshSubagentToolUpdate,
  dshSubagentRole,
  isDshSubagentToolName,
  parseDshSubagentStart,
  upsertSubagentTask,
} from "./subagent-projection.js";

test("DSH subagent projection only matches the native subagent tool", () => {
  assert.equal(isDshSubagentToolName("subagent"), true);
  assert.equal(isDshSubagentToolName("subagent:reviewer"), true);
  assert.equal(isDshSubagentToolName("bash"), false);
  assert.equal(isDshSubagentToolName("task"), false);
});

test("DSH subagent role prefers the ACP rawInput label", () => {
  assert.equal(dshSubagentRole({ description: "环境巡检" }), "环境巡检");
  assert.equal(dshSubagentRole({ prompt: "look around" }, "subagent"), "look around");
  assert.equal(dshSubagentRole({}, "subagent"), "subagent");
});

test("ACP tool content and start acknowledgements keep background children live", () => {
  assert.equal(acpToolContentText({
    content: [{ type: "content", content: { type: "text", text: "started subagent cf4fb9a2" } }],
  }), "started subagent cf4fb9a2");
  assert.deepEqual(parseDshSubagentStart("started subagent cf4fb9a2"), {
    id: "cf4fb9a2",
    mode: "continuable",
  });
  assert.deepEqual(parseDshSubagentStart("started background subagent job job-1"), {
    id: "job-1",
    mode: "job",
  });
  assert.equal(parseDshSubagentStart("the workspace is empty"), null);
});

test("ACP tool_call start and started-id updates project a running roster row", () => {
  const started = applyDshSubagentToolUpdate([], {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "subagent",
    rawInput: { description: "环境巡检" },
  });
  assert.deepEqual(started, [{
    id: "call-1",
    role: "环境巡检",
    status: "running",
    toolCallId: "call-1",
  }]);
  const live = applyDshSubagentToolUpdate(started, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "started subagent cf4fb9a2" } }],
  });
  assert.deepEqual(live, [{
    id: "cf4fb9a2",
    role: "环境巡检",
    status: "running",
    toolCallId: "call-1",
  }]);
});

test("foreground subagent completion settles the same roster row", () => {
  const running = upsertSubagentTask([], {
    id: "call-2",
    role: "writer",
    status: "running",
    toolCallId: "call-2",
  });
  const done = applyDshSubagentToolUpdate(running, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-2",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "wrote the file" } }],
  });
  assert.equal(done[0].status, "succeeded");
});
