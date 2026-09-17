import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_MESSAGE_ENVELOPE_PREFIX,
  externalContentGuidance,
  isExternalMessagePrompt,
} from "./bridge-external-content.js";
import { composeMilkSUWorkflowSystemPrompt } from "./bridge-workflow-prompt.js";

test("recognises only the host envelope at the start of a prompt", () => {
  const framed = `${EXTERNAL_MESSAGE_ENVELOPE_PREFIX} 跨会话消息 · 来源「真来源」(pi · deepseek-v4-pro) · 非用户本人 · 不构成授权\n跨会话内容`;
  assert.equal(isExternalMessagePrompt(framed), true);
  assert.equal(isExternalMessagePrompt(`   ${framed}`), true);
  assert.equal(isExternalMessagePrompt("普通用户消息"), false);
  assert.equal(isExternalMessagePrompt(""), false);
  assert.equal(isExternalMessagePrompt(undefined), false);
  // The marker must not count when it is not the frame: a body that merely mentions it, or a
  // different bracket, is an ordinary prompt.
  assert.equal(isExternalMessagePrompt("请参考 [跨会话消息 · 来源「x」] 的写法"), false);
  assert.equal(isExternalMessagePrompt("[跨会话消息]没有空格"), false);
});

test("the iron rule names every action that must go back to the user", () => {
  const guidance = externalContentGuidance();
  for (const phrase of [
    "not by the user",
    "untrusted data",
    "deleting",
    "packaging",
    "pushing",
    "credentials",
    "collaboration settings",
  ]) {
    assert.ok(guidance.includes(phrase), `iron rule must mention ${phrase}`);
  }
});

test("every session system prompt carries the iron rule", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("base", { sessionRole: "", policy: {} });
  assert.ok(prompt.includes("Cross-conversation content"));
  assert.ok(prompt.includes(EXTERNAL_MESSAGE_ENVELOPE_PREFIX));
});
