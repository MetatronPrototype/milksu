import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createThinkingRepetitionGuard,
  THINKING_REPEAT_LINES,
  THINKING_REPEAT_NOTICE,
  THINKING_REPEAT_STOP_LINES,
} from "./bridge-thinking-repetition.js";

function feed(guard, lines) {
  let hit = null;
  for (const line of lines) {
    hit = guard.push("conversation-1", `${line}\n`) ?? hit;
  }
  return hit;
}

test("a repeated line fires the guard after the threshold, and only once", () => {
  const guard = createThinkingRepetitionGuard();
  const hit = feed(guard, Array.from({ length: THINKING_REPEAT_LINES }, () => "(unchanged)"));
  assert.ok(hit, "eight identical lines must fire");
  assert.equal(hit.run, THINKING_REPEAT_LINES);
  assert.equal(hit.line, "(unchanged)");
  // 只报一次：同一会话的同一个思考步不该刷屏。
  assert.equal(guard.push("conversation-1", "(unchanged)\n"), null);
});

test("long thinking that differs every line never fires", () => {
  const guard = createThinkingRepetitionGuard();
  const lines = Array.from({ length: 30 }, (_, index) => `step ${index}: a different thought`);
  assert.equal(feed(guard, lines), null);
});

test("deltas that arrive mid line are buffered, not treated as separate lines", () => {
  const guard = createThinkingRepetitionGuard();
  // 一个 delta 里只有半行 ⇒ 不能算两行。
  let hit = null;
  for (let index = 0; index < 10; index += 1) {
    hit = guard.push("conversation-1", "(unch") ?? hit;
    hit = guard.push("conversation-1", "anged)\n") ?? hit;
  }
  assert.ok(hit, "split deltas of one repeated line must still fire");
});

// ③ 无静默路径：命中后必须有可见提示 —— 侧车必须把成对双语的 notice 挂在**已有事件名**上。
test("the sidecar answers a repeat with a visible notice, never silently", () => {
  const bridge = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
  assert.ok(bridge.includes("thinkingRepetition.push("), "the delta outlet must feed the guard");
  const outlet = bridge.slice(bridge.indexOf("thinkingRepetition.push("));
  assert.ok(outlet.includes('emit(conversationId, "guard.alarm"'), "a hit must emit guard.alarm");
  assert.ok(outlet.includes("THINKING_REPEAT_NOTICE.notice"));
  assert.ok(outlet.includes("THINKING_REPEAT_NOTICE.noticeEnglish"));
  assert.ok(THINKING_REPEAT_NOTICE.notice.length > 0 && THINKING_REPEAT_NOTICE.noticeEnglish.length > 0);
});

// ④ 跨层断言（本件教训的固化）：侧车发的名字必须**就是** app 认得并会显示的名字。
test("the name the sidecar emits is the name the renderer consumes", () => {
  const app = readFileSync(new URL("../../app/src/composables/useConversations.ts", import.meta.url), "utf8");
  assert.ok(app.includes("if (type === 'guard.alarm')"), "the renderer must have a guard.alarm branch");
  const branch = app.slice(app.indexOf("if (type === 'guard.alarm')"), app.indexOf("if (type === 'attachment.held')"));
  assert.ok(branch.includes("noticeEnglish"), "the renderer must read the paired English notice");
  assert.ok(branch.includes("pushEngineNotice("), "the renderer must show it, not swallow it");
  // 旧的 guard.alarm 调用点（受保护路径）也要成对，别让同一事件名有两种载荷形状。
  const bridge = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
  const payloads = bridge.split('"guard.alarm"').slice(1);
  for (const payload of payloads) {
    const head = payload.slice(0, 400);
    assert.ok(head.includes("noticeEnglish"), `every guard.alarm payload must be paired: ${head.slice(0, 120)}`);
  }
});

// 第二道闸（**会停轮**）的边界。读者问过「怎么判定而不误伤」⇒ 三道闸全过才停。
test("第二道闸：同一行 ≥16 字符、连续 ≥24 次、到这一步结束仍在重复 ⇒ 判为死循环", () => {
  const guard = createThinkingRepetitionGuard();
  const line = "the same long sentence repeated over and over again";
  let hit = null;
  for (let index = 0; index < THINKING_REPEAT_STOP_LINES; index += 1) {
    hit = guard.push("conversation-1", `${line}\n`) ?? hit;
  }
  assert.ok(hit, "第一道闸（8 次）仍要先提示读者");
  const stop = guard.pendingStop("conversation-1");
  assert.equal(stop?.run, THINKING_REPEAT_STOP_LINES);
  assert.equal(stop?.line, line);
});

test("第二道闸：23 次不到阈值 ⇒ 不停轮", () => {
  const guard = createThinkingRepetitionGuard();
  for (let index = 0; index < THINKING_REPEAT_STOP_LINES - 1; index += 1) {
    guard.push("conversation-1", `${"x".repeat(40)}\n`);
  }
  assert.equal(guard.pendingStop("conversation-1"), null);
});

test("第二道闸：结构性短行（} 之类）哪怕几十次也不停轮", () => {
  const guard = createThinkingRepetitionGuard();
  for (let index = 0; index < 40; index += 1) guard.push("conversation-1", "  }\n");
  assert.equal(guard.pendingStop("conversation-1"), null, "短行是正常输出，不该停轮");
});

test("第二道闸：快到结束时换过行 ⇒ 说明它自己想通了，不停轮", () => {
  const guard = createThinkingRepetitionGuard();
  const line = "the same long sentence repeated over and over again";
  for (let index = 0; index < 30; index += 1) guard.push("conversation-1", `${line}\n`);
  guard.push("conversation-1", "and now a different line\n");
  assert.equal(guard.pendingStop("conversation-1"), null);
});

test("接线：thinking_end 命中第二道闸时会通知 + 真的停轮（源码守卫）", () => {
  const bridge = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
  const branch = bridge.slice(
    bridge.indexOf('update.type === "thinking_end"'),
    bridge.indexOf('update.type === "text_delta"'),
  );
  assert.ok(branch.includes("thinkingRepetition.pendingStop(conversationId)"), "必须在这一步结束时问一次");
  assert.ok(branch.includes('emit(conversationId, "guard.alarm"'), "必须告诉读者（绝不静默）");
  assert.ok(branch.includes("session.abort()"), "必须真的停轮，而不是只提示");
});
