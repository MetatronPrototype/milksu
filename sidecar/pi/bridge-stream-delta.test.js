import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeltaAwareWriter,
  createStreamDeltaCoalescer,
  DEFAULT_STREAM_DELTA_FLUSH_MS,
} from "./bridge-stream-delta.js";

function manualScheduler() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeoutFn(callback, delayMs) {
      nextId += 1;
      timers.set(nextId, { callback, delayMs });
      return nextId;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    pending() {
      return timers.size;
    },
    fire() {
      const pending = [...timers.values()];
      timers.clear();
      for (const timer of pending) timer.callback();
    },
  };
}

test("tokens of one stream become one batched delta per flush", () => {
  const scheduler = manualScheduler();
  const batches = [];
  const coalescer = createStreamDeltaCoalescer({
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    onFlush: value => batches.push(value),
  });

  for (const token of ["你", "好", "，", "世界"]) {
    coalescer.queue("text_delta", "conversation-1", token);
  }
  assert.equal(coalescer.pendingCount(), 1);
  assert.equal(scheduler.pending(), 1, "one timer covers the whole stream");
  assert.equal(batches.length, 0, "nothing leaves before the batch closes");

  scheduler.fire();
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [{ type: "text_delta", id: "conversation-1", delta: "你好，世界" }]);
  assert.equal(coalescer.pendingCount(), 0);
});

test("answer text, thinking and other conversations never share a batch", () => {
  const scheduler = manualScheduler();
  const batches = [];
  const coalescer = createStreamDeltaCoalescer({
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    onFlush: value => batches.push(value),
  });

  coalescer.queue("text_delta", "conversation-1", "answer");
  coalescer.queue("thinking_delta", "conversation-1", "thought");
  coalescer.queue("text_delta", "conversation-2", "other");
  coalescer.queue("text_delta", "", "");
  scheduler.fire();

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [
    { type: "text_delta", id: "conversation-1", delta: "answer" },
    { type: "thinking_delta", id: "conversation-1", delta: "thought" },
    { type: "text_delta", id: "conversation-2", delta: "other" },
  ]);
});

test("an explicit flush emits at once and an empty flush is a no-op", () => {
  const scheduler = manualScheduler();
  const batches = [];
  const coalescer = createStreamDeltaCoalescer({
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    onFlush: value => batches.push(value),
  });

  coalescer.queue("thinking_delta", "conversation-1", "a");
  coalescer.flush();
  assert.equal(scheduler.pending(), 0);
  assert.equal(batches.length, 1);
  coalescer.flush();
  assert.equal(batches.length, 1, "an empty flush must not emit an empty event");
});

test("the default flush window is 60ms", () => {
  assert.equal(DEFAULT_STREAM_DELTA_FLUSH_MS, 60);
});

test("a buffered answer is written before the tool call that follows it", async () => {
  const written = [];
  const coalescer = createStreamDeltaCoalescer({
    flushMs: 5_000,
    onFlush: batches => {
      for (const { type, id, delta } of batches) written.push({ id, type, delta });
    },
  });
  const emit = createDeltaAwareWriter({
    coalescer,
    write: (id, type, data) => written.push({ id, type, ...data }),
  });

  // The pi handler queues deltas; every other event goes through the one writer.
  coalescer.queue("text_delta", "conversation-1", "先说明。");
  coalescer.queue("text_delta", "conversation-1", "然后调用工具。");
  assert.equal(coalescer.pendingCount(), 1);

  // The tool call follows the paragraph: the paragraph must be written out first, merged and
  // non-empty - never overtaken, never dropped.
  emit("conversation-1", "tool_call_start", { toolName: "deliver_to_conversation" });

  assert.deepEqual(written, [
    { id: "conversation-1", type: "text_delta", delta: "先说明。然后调用工具。" },
    { id: "conversation-1", type: "tool_call_start", toolName: "deliver_to_conversation" },
  ]);
  assert.equal(coalescer.pendingCount(), 0);
});

test("a turn that ends right after the paragraph still writes it", () => {
  const written = [];
  const coalescer = createStreamDeltaCoalescer({
    flushMs: 5_000,
    onFlush: batches => {
      for (const { type, id, delta } of batches) written.push({ id, type, delta });
    },
  });
  const emit = createDeltaAwareWriter({
    coalescer,
    write: (id, type, data) => written.push({ id, type, ...data }),
  });

  coalescer.queue("text_delta", "conversation-1", "最后一段。");
  emit("conversation-1", "turn_settled", {});

  assert.equal(written.length, 2);
  assert.equal(written[0].type, "text_delta");
  assert.equal(written[0].delta, "最后一段。");
  assert.equal(written[1].type, "turn_settled");
});

test("an empty delta never produces an empty text event", () => {
  const written = [];
  const coalescer = createStreamDeltaCoalescer({
    flushMs: 5_000,
    onFlush: batches => {
      for (const { type, id, delta } of batches) written.push({ id, type, delta });
    },
  });
  const emit = createDeltaAwareWriter({
    coalescer,
    write: (id, type, data) => written.push({ id, type, ...data }),
  });

  coalescer.queue("text_delta", "conversation-1", "");
  emit("conversation-1", "tool_call_start", { toolName: "bash" });
  assert.deepEqual(written.map(item => item.type), ["tool_call_start"]);
});
