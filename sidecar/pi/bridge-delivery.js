import { randomUUID } from "node:crypto";

/**
 * Cross-conversation delivery is a request the sidecar cannot answer alone: the host owns
 * the project boundary, the schedule and the queue. The tool used to return "handed to
 * MilkSU" no matter what happened, so a refused delivery looked delivered and a queued one
 * looked dropped. This broker waits for the host's verdict and hands it back to the tool.
 *
 * A missing verdict is its own outcome ("unknown"), not a success: the tool must never
 * claim more than the host confirmed.
 */
export const DELIVERY_ACK_TIMEOUT_MS = 15_000;

export function createDeliveryBroker(
  emit,
  createID = randomUUID,
  timeoutMs = DELIVERY_ACK_TIMEOUT_MS,
) {
  const pending = new Map();

  function resolveRequest(requestID, outcome) {
    const request = pending.get(requestID);
    if (!request) return false;
    pending.delete(requestID);
    clearTimeout(request.timer);
    request.resolve(outcome);
    return true;
  }

  return {
    request({ conversationId, targetConversationId, text, origin, kind }) {
      const requestID = createID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (resolveRequest(requestID, { status: "unknown", detail: "" })) {
            emit(conversationId, "agent.delivery_timeout", { requestId: requestID });
          }
        }, timeoutMs);
        // Node keeps the event loop alive for a pending timer; the sidecar is long-lived,
        // so the timer must not hold the process after the host answered.
        timer.unref?.();
        pending.set(requestID, {
          conversationId,
          timer,
          resolve: outcome => resolve(outcome),
        });
        emit(conversationId, "agent.delivery", {
          requestId: requestID,
          targetConversationId,
          text,
          kind: kind === "result" ? "result" : "request",
          deliveryOrigin: origin,
        });
      });
    },

    /**
     * A late verdict (the timeout already fired, or the host echoed an unknown id) is not
     * an error: the tool has already returned. It is simply dropped.
     */
    respond({ conversationId, requestId, status, detail }) {
      const request = pending.get(requestId);
      if (!request || request.conversationId !== conversationId) return false;
      return resolveRequest(requestId, {
        status: String(status ?? "").trim(),
        detail: String(detail ?? "").trim(),
      });
    },

    cancelConversation(conversationId) {
      for (const [requestID, request] of [...pending]) {
        if (request.conversationId === conversationId) {
          resolveRequest(requestID, { status: "unknown", detail: "the turn ended" });
        }
      }
    },

    cancelAll() {
      for (const requestID of [...pending.keys()]) {
        resolveRequest(requestID, { status: "unknown", detail: "the sidecar is closing" });
      }
    },

    pendingCount() {
      return pending.size;
    },
  };
}
