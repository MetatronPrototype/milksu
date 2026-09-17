// Visible progress before every tool call (MilkSU turn contract).
//
// The reader only sees text blocks. A step that goes straight from thinking to a tool call
// therefore leaves the answer area empty for as long as the tools run, and the reasoning that
// would have explained the step is invisible to the user - they read that as "the agent went
// silent".
//
// This is deliberately NOT a gate. Blocking a tool call so the model can re-issue it with text
// was tried in beta.15 and made things worse: the interrupted step reached the reader with no
// text at all, which is exactly the defect it was meant to fix. So the contract is carried by
// the persistent system-prompt rule plus a reminder injected into the model's own context,
// before the next request, whenever the last step called a tool with no visible text. Nothing
// is blocked, no turn is interrupted, and the reader's transcript is never touched.

export const visibleProgressRule = [
  "Visible progress: the user reads text blocks, not thinking.",
  "Before every tool call, write one short sentence of visible text saying what you are about",
  "to do and why, then make the call. Never leave the only explanation of a step inside",
  "thinking - thinking is not the answer. A step that calls a tool with no visible text reads",
  "to the user as silence, so treat it as a defect.",
].join("\n");

export const visibleProgressMessageType = "milksu-visible-progress";

/**
 * A product-owned reminder for the model only: it is injected into the outgoing request and is
 * never displayed, so it cannot add noise to the conversation the reader sees.
 */
export const visibleProgressReminder = [
  "[MilkSU visible progress] The step you just took called a tool without any visible text.",
  "The user only sees text blocks - thinking is invisible to them - so that step reached them",
  "as silence. Before your next tool call, write one short sentence they can read (what you are",
  "about to do and why), and then call the tool. Every tool call still needs that sentence.",
].join(" ");

function messageBlocks(message) {
  const content = message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function hasVisibleText(message) {
  return messageBlocks(message).some(block => (
    String(block?.type ?? "") === "text" && String(block?.text ?? "").trim().length > 0
  ));
}

function hasToolCall(message) {
  return messageBlocks(message).some(block => String(block?.type ?? "") === "toolCall");
}

function isVisibleProgressReminder(message) {
  return message?.role === "custom" && message.customType === visibleProgressMessageType;
}

/**
 * True when the last assistant step called at least one tool and wrote no visible text at all.
 * `messages` is the model-visible context (pi's `context` event), so this reads exactly what the
 * model produced - no stream bookkeeping to get out of order.
 */
export function assistantStepMissingVisibleText(messages) {
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isVisibleProgressReminder(message)) continue;
    if (message?.role !== "assistant") continue;
    if (hasVisibleText(message)) return false;
    return hasToolCall(message);
  }
  return false;
}

/**
 * Append the reminder for this request only. Pi treats a `context` result as request-scoped, so
 * the reminder never becomes part of the stored conversation, and `display: false` keeps it out
 * of any transcript reader. Returns undefined when this request needs no reminder, which is the
 * common case.
 */
export function withVisibleProgressReminder(messages) {
  if (!Array.isArray(messages) || !messages.length) return undefined;
  // One reminder per request: a request that already carries it (the model has not answered yet)
  // must not stack a second copy.
  if (isVisibleProgressReminder(messages[messages.length - 1])) return undefined;
  // Only the defective state is touched: a healthy turn's request is passed through untouched,
  // so this can never slow down or disturb a turn that already narrates.
  if (!assistantStepMissingVisibleText(messages)) return undefined;
  return [
    ...messages,
    {
      role: "custom",
      customType: visibleProgressMessageType,
      content: visibleProgressReminder,
      display: false,
      details: { scope: "current-request", reason: "silent-step" },
    },
  ];
}
