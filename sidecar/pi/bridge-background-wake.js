// Terminal background-task callbacks are opt-in and coalesced. The reviewed
// background-task package owns the wake, but its bundle is a separate module
// instance from bridge.js, so the pure batching state machine and the
// process-global notifier seam live here and both the bundle and the sidecar
// tests import this one file.
export const DEFAULT_WAKE_BATCH_WINDOW_MS = 10_000;

export function createBackgroundWakeBatcher(options = {}) {
  const windowMs = Number(options.windowMs ?? DEFAULT_WAKE_BATCH_WINDOW_MS);
  const schedule = options.setTimeoutFn ?? setTimeout;
  const cancel = options.clearTimeoutFn ?? clearTimeout;
  const onFlush = options.onFlush;
  const pending = new Map();
  let timer;

  function enqueue(task) {
    const id = String(task?.id ?? "").trim();
    if (!id) return;
    pending.set(id, { ...task, id });
    if (timer !== undefined) return;
    timer = schedule(() => {
      timer = undefined;
      void flush();
    }, windowMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  async function flush() {
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    const tasks = [...pending.values()];
    pending.clear();
    if (!tasks.length) return;
    if (typeof onFlush === "function") await onFlush(tasks);
  }

  return {
    enqueue,
    flush,
    pendingCount: () => pending.size,
    hasTimer: () => timer !== undefined,
  };
}

export function registerBackgroundWakeNotifier(pi, notify) {
  const registry = globalThis.__milksuBackgroundWakeNotify instanceof Map
    ? globalThis.__milksuBackgroundWakeNotify
    : new Map();
  registry.set(pi, notify);
  globalThis.__milksuBackgroundWakeNotify = registry;
}

export function unregisterBackgroundWakeNotifier(pi) {
  if (globalThis.__milksuBackgroundWakeNotify instanceof Map) {
    globalThis.__milksuBackgroundWakeNotify.delete(pi);
  }
}

export function milkSUWakeNotifier(pi) {
  const registry = globalThis.__milksuBackgroundWakeNotify;
  if (!(registry instanceof Map)) return undefined;
  const notify = registry.get(pi);
  return typeof notify === "function" ? notify : undefined;
}
