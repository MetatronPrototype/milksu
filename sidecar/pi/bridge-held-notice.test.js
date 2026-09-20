import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 「held 为空 ⇒ 绝不发事件」这条在 bridge.js 里靠守卫保证：emit 必须在 `if (heldNotice)` 之内。
// 用源码断言锁住这个形状（比 mock 整个 bridge 便宜，回归时立刻红）。
test("the held-attachment event is emitted only when a notice exists", async () => {
  const source = await readFile(new URL("./bridge.js", import.meta.url), "utf8");

  // ① 必须存在"先算 payload、再在守卫里 emit"的形状（payload 为 null 时不发）。
  const guarded = /const heldNotice = heldAttachmentNoticePayload\(prepared\.held\);\s*(?:\/\/[^\n]*\n\s*)*if \(heldNotice\) \{\s*emit\(conversationId, "attachment\.held", heldNotice\);/;
  assert.equal(guarded.test(source), true, "attachment.held must be emitted only inside `if (heldNotice)`");

  // ② 这个事件名在 emit 里只许出现一次（多一处 = 可能有一处是裸发）。
  const emissions = source.match(/emit\(conversationId, "attachment\.held"/g) ?? [];
  assert.equal(emissions.length, 1, "attachment.held must be emitted from exactly one place");
});
