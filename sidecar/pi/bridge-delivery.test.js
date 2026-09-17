import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryBroker } from "./bridge-delivery.js";

test("delivery broker waits for the host verdict and reports a queue", async () => {
  const events = [];
  const broker = createDeliveryBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "delivery-1",
  );
  const outcome = broker.request({
    conversationId: "conversation-source",
    targetConversationId: "conversation-target",
    text: "请接着做",
    kind: "result",
    origin: { conversationId: "conversation-source" },
  });
  assert.equal(events[0].type, "agent.delivery");
  assert.equal(events[0].requestId, "delivery-1");
  assert.equal(events[0].targetConversationId, "conversation-target");
  // A result reply travels with its form so the host can hold it to that grant.
  assert.equal(events[0].kind, "result");
  // The sidecar only names its own id: the host resolves the title and agent.
  assert.deepEqual(events[0].deliveryOrigin, { conversationId: "conversation-source" });

  assert.equal(broker.respond({
    conversationId: "conversation-source",
    requestId: "delivery-1",
    status: "queued",
    detail: "Dev",
  }), true);
  assert.deepEqual(await outcome, { status: "queued", detail: "Dev" });
  assert.equal(broker.pendingCount(), 0);
});

test("an unspecified or unknown kind is a request", () => {
  let id = 0;
  const events = [];
  const broker = createDeliveryBroker((conversationId, type, data) => events.push(data), () => `delivery-${++id}`);
  broker.request({
    conversationId: "conversation-source",
    targetConversationId: "conversation-target",
    text: "a",
    origin: { conversationId: "conversation-source" },
  });
  broker.request({
    conversationId: "conversation-source",
    targetConversationId: "conversation-target",
    text: "b",
    kind: "please",
    origin: { conversationId: "conversation-source" },
  });
  assert.equal(events[0].kind, "request");
  assert.equal(events[1].kind, "request");
  broker.cancelAll();
});

test("delivery broker refuses an answer for another conversation", async () => {
  let id = 0;
  const broker = createDeliveryBroker(() => undefined, () => `delivery-${++id}`);
  const outcome = broker.request({
    conversationId: "conversation-source",
    targetConversationId: "conversation-target",
    text: "hello",
    origin: { conversationId: "conversation-source" },
  });
  assert.equal(broker.respond({
    conversationId: "conversation-other",
    requestId: "delivery-2",
    status: "delivered",
  }), false);
  broker.cancelConversation("conversation-source");
  assert.deepEqual(await outcome, { status: "unknown", detail: "the turn ended" });
});

test("delivery broker times out into an unconfirmed outcome", async () => {
  const events = [];
  const broker = createDeliveryBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "delivery-timed-out",
    5,
  );
  const outcome = broker.request({
    conversationId: "conversation-source",
    targetConversationId: "conversation-target",
    text: "hello",
    origin: { conversationId: "conversation-source" },
  });
  assert.deepEqual(await outcome, { status: "unknown", detail: "" });
  assert.equal(events.some(event => event.type === "agent.delivery_timeout"), true);
  // A late verdict after the timeout is dropped instead of throwing.
  assert.equal(broker.respond({
    conversationId: "conversation-source",
    requestId: "delivery-timed-out",
    status: "delivered",
  }), false);
});
