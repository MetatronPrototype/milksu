import assert from "node:assert/strict";
import test from "node:test";
import { createDeliverySpool, shouldSpoolDelivery } from "./bridge-delivery-spool.js";

// 假的文件系统 + 注入的时钟：不碰真磁盘，也不用真等（Dev 明确要求）。
function fakeFs() {
  const files = new Map();
  return {
    files,
    mkdir: async () => {},
    writeFile: async (path, data) => { files.set(path, data); },
    readdir: async () => [...files.keys()].map(key => key.split("/").pop()),
    readFile: async (path) => files.get(path),
    unlink: async (path) => { files.delete(path); },
  };
}

function spoolAt(fs, clock) {
  return createDeliverySpool({ dir: "/spool", now: clock, createID: (() => { let n = 0; return () => `id${++n}`; })(), fs });
}

test("a refused delivery is written to the spool with target, time and the original text", async () => {
  const fs = fakeFs();
  const spool = spoolAt(fs, () => 1_700_000_000_000);
  assert.equal(await spool.record({
    targetConversationId: "conv-b",
    text: "回执原文在这里",
    kind: "result",
    status: "refused",
    detail: "loop-circuit-open",
  }), true);
  const [entry] = await spool.pending();
  assert.equal(entry.targetConversationId, "conv-b");
  assert.equal(entry.at, 1_700_000_000_000);
  assert.equal(entry.text, "回执原文在这里");
  assert.equal(entry.status, "refused");
});

test("the next successful delivery carries the lost hand-off, and the spool is cleared", async () => {
  const fs = fakeFs();
  const spool = spoolAt(fs, () => 1_700_000_000_000);
  await spool.record({ targetConversationId: "conv-b", text: "第一条没送到", status: "refused" });
  const pending = await spool.pending();
  const prefix = spool.formatPrefix(pending, true);
  assert.match(prefix, /未送达/);
  assert.match(prefix, /第一条没送到/);
  assert.match(prefix, /conv-b/);
  // 双语成对
  assert.match(spool.formatPrefix(pending, false), /was not delivered/);
  assert.equal(await spool.clear(pending), 1);
  assert.deepEqual(await spool.pending(), []);
});

test("nothing is spooled when nothing failed", async () => {
  const fs = fakeFs();
  const spool = spoolAt(fs, () => 1_700_000_000_000);
  assert.deepEqual(await spool.pending(), []);
  assert.equal(spool.formatPrefix([], true), "");
  assert.equal(fs.files.size, 0);
});

test("only genuinely undelivered hand-offs are spooled", () => {
  assert.equal(shouldSpoolDelivery("refused"), true);
  assert.equal(shouldSpoolDelivery("unknown"), true);
  assert.equal(shouldSpoolDelivery(""), true);
  assert.equal(shouldSpoolDelivery("delivered"), false);
  // 排队是"已被接收"，不是失败 —— 记成失败会导致错误补投。
  assert.equal(shouldSpoolDelivery("queued"), false);
});

test("entries are replayed oldest first", async () => {
  const fs = fakeFs();
  let clock = 1_000;
  const spool = createDeliverySpool({ dir: "/spool", now: () => clock, fs });
  await spool.record({ targetConversationId: "b", text: "先", status: "refused" });
  clock = 2_000;
  await spool.record({ targetConversationId: "b", text: "后", status: "refused" });
  const pending = await spool.pending();
  assert.deepEqual(pending.map(entry => entry.text), ["先", "后"]);
});

test("a disabled spool is silent and harmless", async () => {
  const spool = createDeliverySpool({});
  assert.equal(spool.enabled, false);
  assert.equal(await spool.record({ targetConversationId: "b", text: "x" }), false);
  assert.deepEqual(await spool.pending(), []);
  assert.equal(spool.formatPrefix([{ at: 1, id: "a", targetConversationId: "b", text: "x" }]), "");
});
