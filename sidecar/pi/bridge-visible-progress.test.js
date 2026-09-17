import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assistantStepMissingVisibleText,
  visibleProgressMessageType,
  visibleProgressReminder,
  visibleProgressRule,
  withVisibleProgressReminder,
} from "./bridge-visible-progress.js";

function assistant(blocks) {
  return { role: "assistant", content: blocks };
}
function toolResult() {
  return { role: "toolResult", content: [{ type: "text", text: "ok" }] };
}

test("the rule tells the model to write visible text before each tool call", () => {
  assert.match(visibleProgressRule, /Before every tool call/);
  assert.match(visibleProgressRule, /thinking is not the answer/);
  assert.match(visibleProgressRule, /as silence/);
});

// The beta.15 gate blocked the call and the step reached the reader with no text at all, so no
// code path here may block, terminate or otherwise interrupt a turn again.
test("this module can never block or terminate a tool call", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "bridge-visible-progress.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /block\s*:/);
  assert.doesNotMatch(source, /terminate/);
  assert.match(visibleProgressReminder, /The step you just took called a tool without any visible text/);
  assert.match(visibleProgressReminder, /write one short sentence/);
});

test("detects a step that called a tool with no visible text", () => {
  assert.equal(assistantStepMissingVisibleText([
    { role: "user", content: "做三件事" },
    assistant([{ type: "thinking", thinking: "我先看看" }, { type: "toolCall", name: "bash" }]),
  ]), true);

  // Empty/whitespace text does not count as visible.
  assert.equal(assistantStepMissingVisibleText([
    { role: "user", content: "做三件事" },
    assistant([{ type: "text", text: "   " }, { type: "toolCall", name: "bash" }]),
  ]), true);

  // A plain string content message with a tool call.
  assert.equal(assistantStepMissingVisibleText([
    assistant([{ type: "toolCall", name: "read" }]),
  ]), true);
});

test("stays quiet when the step had visible text or no tool call", () => {
  assert.equal(assistantStepMissingVisibleText([
    assistant([{ type: "text", text: "我先查一下。" }, { type: "toolCall", name: "bash" }]),
  ]), false);
  // Thinking only, no tool call: that is the empty-turn case, which the chat UI explains.
  assert.equal(assistantStepMissingVisibleText([
    assistant([{ type: "thinking", thinking: "想了很久" }]),
  ]), false);
  assert.equal(assistantStepMissingVisibleText([]), false);
  assert.equal(assistantStepMissingVisibleText(undefined), false);
});

test("the reminder is appended once per request and never displayed", () => {
  const messages = [
    { role: "user", content: "做三件事" },
    assistant([{ type: "thinking", thinking: "我先看看" }, { type: "toolCall", name: "bash" }]),
    toolResult(),
  ];
  const next = withVisibleProgressReminder(messages);
  assert.equal(next.length, messages.length + 1);
  const reminder = next.at(-1);
  assert.equal(reminder.role, "custom");
  assert.equal(reminder.customType, visibleProgressMessageType);
  assert.equal(reminder.display, false);
  assert.match(String(reminder.content), /visible progress/);

  // The original list is left alone.
  assert.equal(messages.length, 3);

  // Idempotent: a request that already carries the reminder is not stacked.
  assert.equal(withVisibleProgressReminder(next), undefined);

  // Nothing to inject when the step already spoke.
  assert.equal(withVisibleProgressReminder([
    assistant([{ type: "text", text: "我先查一下。" }, { type: "toolCall", name: "bash" }]),
  ]), undefined);
});

test("an earlier silent step does not re-fire after the model started narrating", () => {
  assert.equal(withVisibleProgressReminder([
    { role: "user", content: "做三件事" },
    assistant([{ type: "toolCall", name: "bash" }]),
    toolResult(),
    assistant([{ type: "text", text: "现在写第二件事。" }, { type: "toolCall", name: "read" }]),
    toolResult(),
  ]), undefined);
});

// A healthy turn is never touched: only a request whose last step was silent carries the
// reminder, so this can never disturb a turn that already narrates.
test("a turn that has not gone silent yet is passed through untouched", () => {
  assert.equal(withVisibleProgressReminder([{ role: "user", content: "做三件事" }]), undefined);
});
