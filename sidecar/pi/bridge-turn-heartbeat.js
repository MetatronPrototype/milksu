export const TURN_HEARTBEAT_MS = 5_000;

/**
 * A turn that is alive keeps saying so. The UI used to infer "the engine is not responding"
 * from silence alone, which turned a long tool or a slow model call into a false alarm: the
 * heartbeat is the engine-side signal that separates "busy" from "gone".
 *
 * The interval is unref'd so it never holds the sidecar process open on its own.
 */
export function startTurnHeartbeat({
  emit,
  conversationId,
  intervalMs = TURN_HEARTBEAT_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  const timer = setIntervalImpl(() => {
    emit(conversationId, "turn.heartbeat");
  }, intervalMs);
  timer?.unref?.();
  return () => clearIntervalImpl(timer);
}
