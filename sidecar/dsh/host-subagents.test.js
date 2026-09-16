import assert from "node:assert/strict";
import test from "node:test";
import {
  interruptAllHostSubagents,
  interruptHostSubagent,
  listHostSubagents,
  projectHostSubagentEntries,
} from "./host-subagents.js";

test("host catalog rows become Working tasks", () => {
  assert.deepEqual(projectHostSubagentEntries([
    { kind: "child", id: "cf4fb9a2", activity: "running", mode: "continuable", label: "环境巡检" },
    { kind: "diagnostic", id: "bad", reason: "unavailable" },
    { kind: "child", id: "idle-1", activity: "inactive", mode: "one-shot", label: "done" },
  ]), [
    { id: "cf4fb9a2", role: "环境巡检", status: "running", toolCallId: "cf4fb9a2" },
    { id: "idle-1", role: "done", status: "succeeded", toolCallId: "idle-1" },
  ]);
});

test("list and interrupt go through ctx.subagents, not a second harness", async () => {
  const interrupted = [];
  const drained = [];
  const parent = { id: "acp_1" };
  const subagents = {
    async listChildren(sessionId) {
      assert.equal(sessionId, "acp_1");
      return [
        { kind: "child", id: "child-a", activity: "running", mode: "continuable", label: "scout" },
        { kind: "child", id: "child-b", activity: "running", mode: "continuable", label: "review" },
      ];
    },
    interruptByParent(childId, parentId, mode) {
      interrupted.push({ childId, parentId, mode });
    },
    async drainContinuableChildren(agent, childIds) {
      drained.push({ agent, childIds: [...childIds] });
    },
  };
  const agents = { get: (id) => (id === "acp_1" ? parent : null) };
  const listed = await listHostSubagents(subagents, "acp_1");
  assert.deepEqual(listed.map((item) => item.id), ["child-a", "child-b"]);
  await interruptHostSubagent(subagents, agents, "acp_1", "child-a");
  assert.deepEqual(interrupted, [{ childId: "child-a", parentId: "acp_1", mode: "continuable" }]);
  assert.deepEqual(drained, [{ agent: parent, childIds: ["child-a"] }]);
  interrupted.length = 0;
  drained.length = 0;
  const ids = await interruptAllHostSubagents(subagents, agents, "acp_1");
  assert.deepEqual(ids, ["child-a", "child-b"]);
  assert.deepEqual(drained[0].childIds, ["child-a", "child-b"]);
  assert.equal(interrupted.length, 2);
});
