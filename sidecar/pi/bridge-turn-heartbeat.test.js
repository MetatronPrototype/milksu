import assert from "node:assert/strict";
import test from "node:test";
import { TURN_HEARTBEAT_MS, startTurnHeartbeat } from "./bridge-turn-heartbeat.js";

test("a live turn keeps emitting heartbeats until it is stopped", () => {
  const events = [];
  let tick = null;
  let cleared = null;
  const stop = startTurnHeartbeat({
    emit: (conversationId, type) => events.push([conversationId, type]),
    conversationId: "conversation-1",
    intervalMs: 42,
    setIntervalImpl: (callback, interval) => {
      tick = { callback, interval };
      return "timer-1";
    },
    clearIntervalImpl: timer => {
      cleared = timer;
    },
  });

  assert.equal(tick.interval, 42);
  tick.callback();
  tick.callback();
  assert.deepEqual(events, [
    ["conversation-1", "turn.heartbeat"],
    ["conversation-1", "turn.heartbeat"],
  ]);

  stop();
  assert.equal(cleared, "timer-1");
});

test("the default heartbeat is slow enough not to be a stream event", () => {
  assert.equal(TURN_HEARTBEAT_MS, 5000);
  const timers = [];
  const stop = startTurnHeartbeat({
    emit: () => {},
    conversationId: "conversation-2",
    setIntervalImpl: (callback, interval) => {
      timers.push({ callback, interval });
      return 1;
    },
    clearIntervalImpl: () => {},
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].interval, TURN_HEARTBEAT_MS);
  stop();
});
