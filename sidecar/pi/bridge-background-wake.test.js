import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackgroundWakeBatcher,
  DEFAULT_WAKE_BATCH_WINDOW_MS,
  milkSUWakeNotifier,
  registerBackgroundWakeNotifier,
  unregisterBackgroundWakeNotifier,
} from "./bridge-background-wake.js";

// A manual scheduler keeps the batching deterministic: the real 10s window never
// fires inside a unit test, and a leaked real timer would keep node alive.
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
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, timer] of pending) timer.callback();
    },
  };
}

test("a burst of terminal tasks wakes the agent once with the whole batch", async () => {
  const scheduler = manualScheduler();
  const flushes = [];
  const batcher = createBackgroundWakeBatcher({
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    onFlush: tasks => flushes.push(tasks),
  });

  for (const id of ["bg-1", "bg-2", "bg-3", "bg-4", "bg-5"]) {
    batcher.enqueue({ id, name: id, status: "succeeded", endedAt: 1000 });
  }
  assert.equal(batcher.pendingCount(), 5);
  assert.equal(scheduler.pending(), 1, "one window timer covers the whole burst");
  assert.equal(flushes.length, 0, "nothing is delivered before the window closes");

  scheduler.fire();
  await Promise.resolve();
  assert.equal(flushes.length, 1, "the burst is one wake");
  assert.deepEqual(flushes[0].map(task => task.id), ["bg-1", "bg-2", "bg-3", "bg-4", "bg-5"]);
  assert.equal(batcher.pendingCount(), 0);
});

test("re-enqueuing the same task cannot double-wake it", async () => {
  const scheduler = manualScheduler();
  const flushes = [];
  const batcher = createBackgroundWakeBatcher({
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    onFlush: tasks => flushes.push(tasks),
  });

  batcher.enqueue({ id: "bg-1", name: "one", status: "succeeded", endedAt: 1 });
  batcher.enqueue({ id: "bg-1", name: "one again", status: "failed", endedAt: 2 });
  batcher.enqueue({ id: "", name: "no identity", status: "succeeded" });
  scheduler.fire();
  await Promise.resolve();

  assert.equal(flushes.length, 1);
  assert.equal(flushes[0].length, 1);
  assert.equal(flushes[0][0].name, "one again");
});

test("an explicit flush cancels the window timer and a second flush does nothing", async () => {
  const scheduler = manualScheduler();
  const flushes = [];
  const batcher = createBackgroundWakeBatcher({
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    onFlush: tasks => flushes.push(tasks),
  });

  batcher.enqueue({ id: "bg-1", status: "succeeded" });
  await batcher.flush();
  assert.equal(scheduler.pending(), 0);
  assert.equal(flushes.length, 1);
  await batcher.flush();
  assert.equal(flushes.length, 1, "an empty flush must not call the notifier");
});

test("the notifier seam is keyed by the live pi instance", () => {
  const first = { session: "one" };
  const second = { session: "two" };
  const seen = [];
  registerBackgroundWakeNotifier(first, payload => seen.push(["first", payload]));
  registerBackgroundWakeNotifier(second, payload => seen.push(["second", payload]));

  milkSUWakeNotifier(first)?.({ at: 1, tasks: [{ id: "bg-1" }] });
  assert.deepEqual(seen, [["first", { at: 1, tasks: [{ id: "bg-1" }] }]]);

  unregisterBackgroundWakeNotifier(first);
  assert.equal(milkSUWakeNotifier(first), undefined);
  milkSUWakeNotifier(second)?.({ at: 2, tasks: [] });
  assert.equal(seen.length, 2);

  unregisterBackgroundWakeNotifier(second);
  assert.equal(milkSUWakeNotifier({}), undefined);
});

test("the default window is ten seconds", () => {
  assert.equal(DEFAULT_WAKE_BATCH_WINDOW_MS, 10_000);
});
