// Streaming deltas (answer text, thinking) are coalesced into short batches: one
// token must not become one desktop event and one render. Any other engine event
// flushes the pending batch first, so ordering is preserved.
export const DEFAULT_STREAM_DELTA_FLUSH_MS = 60;

export function createStreamDeltaCoalescer(options = {}) {
  const flushMs = Number(options.flushMs ?? DEFAULT_STREAM_DELTA_FLUSH_MS);
  const schedule = options.setTimeoutFn ?? setTimeout;
  const cancel = options.clearTimeoutFn ?? clearTimeout;
  const onFlush = options.onFlush;
  const pending = new Map();
  let timer;

  function flush() {
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    if (!pending.size) return;
    const batches = [...pending.values()];
    pending.clear();
    if (typeof onFlush === "function") onFlush(batches);
  }

  function queue(type, conversationId, delta) {
    const chunk = String(delta ?? "");
    if (!chunk) return;
    const key = `${type}\u0000${conversationId}`;
    const current = pending.get(key);
    pending.set(key, {
      type,
      id: conversationId,
      delta: `${current?.delta ?? ""}${chunk}`,
    });
    if (timer !== undefined) return;
    timer = schedule(flush, flushMs);
  }

  return {
    queue,
    flush,
    pendingCount: () => pending.size,
    hasTimer: () => timer !== undefined,
  };
}

/**
 * The single choke point every engine event goes through. A buffered answer is flushed before
 * anything that is not a delta, so the tool call that follows a paragraph can never overtake
 * it - and a turn that ends right after that paragraph still writes it out.
 */
export function createDeltaAwareWriter({ coalescer, write }) {
  return (conversationId, type, data) => {
    if (type !== "text_delta" && type !== "thinking_delta") coalescer.flush();
    write(conversationId, type, data);
  };
}
