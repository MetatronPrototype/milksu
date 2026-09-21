import assert from "node:assert/strict";
import test from "node:test";
import { steerSession } from "./bridge-steering.js";

// 定下的语义：「加入对话」= 并进本轮，**绝不打断正在跑的工具**。
// 这条测试把 "steerSession 只 steer、不 abort" 钉住：它用一个记录所有调用的假 session，
// 只要将来有人在这条路径上加 abort/interrupt，这里立刻红。
function fakeSession() {
  const calls = [];
  return {
    calls,
    steer(message) { calls.push(["steer", message]); },
    abort(...args) { calls.push(["abort", ...args]); },
    abortSession(...args) { calls.push(["abortSession", ...args]); },
    interrupt(...args) { calls.push(["interrupt", ...args]); },
    prompt(...args) { calls.push(["prompt", ...args]); },
    clearQueue() { calls.push(["clearQueue"]); return { steering: [], followUp: [] }; },
  };
}

function sessionsWith(session, conversationId = "conv-a") {
  return new Map([[conversationId, session]]);
}

test("steering a running turn never aborts the turn or the tool that is running", async () => {
  const session = fakeSession();
  await steerSession(sessionsWith(session), { conversationId: "conv-a", prompt: "并进本轮" });
  assert.deepEqual(session.calls.map(call => call[0]), ["steer"]);
  assert.deepEqual(session.calls[0][1], "并进本轮");
});

// 也绝不另开一个用户回合（那会造成两条并发回合）。
test("steering never opens a parallel user turn", async () => {
  const session = fakeSession();
  await steerSession(sessionsWith(session), { conversationId: "conv-a", prompt: "x" });
  assert.equal(session.calls.some(call => call[0] === "prompt"), false);
});

// 报错路径：会话不存在时必须报错，不许静默什么都不做（否则读者以为并进去了）。
test("steering an unknown conversation fails loudly", async () => {
  await assert.rejects(
    () => steerSession(new Map(), { conversationId: "nope", prompt: "x" }),
    /PI session not found/,
  );
});
