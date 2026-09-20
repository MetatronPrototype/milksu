import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_HELD_OVERSIZED,
  heldAttachmentNoticePayload,
  MAX_IMAGE_SIDE,
  heldImageNoteForAgent,
  heldImageNotice,
  precheckImages,
} from "./bridge-image-precheck.js";
import { imageSizeFromHeader } from "./bridge-image-size.js";

// 合成一张"超限但极小"的 PNG：1x9000，体积只有几十字节。
function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const image = (over) => ({
  id: "a1",
  name: "IMG_2696.JPG",
  mediaType: "image/jpeg",
  sha256: "19a13f27",
  path: "/tmp/IMG_2696.JPG",
  ...over,
});

// 事故根：超限的图不能进本轮请求 ⇒ 也就不会进历史 ⇒ 下一轮不再重放。
test("an oversized image is held back instead of being sent", () => {
  const tall = image({ width: 1179, height: 17728 });
  const { sendable, held } = precheckImages([tall]);
  assert.deepEqual(sendable, []);
  assert.equal(held.length, 1);
  assert.equal(held[0].name, "IMG_2696.JPG");
  assert.equal(held[0].reason, IMAGE_HELD_OVERSIZED);
  assert.equal(held[0].limit, MAX_IMAGE_SIDE);
  // 1x9000 这种"极小但超限"的图同样拦住
  const { sendable: s2, held: h2 } = precheckImages([image({ width: 1, height: 9000 })]);
  assert.deepEqual(s2, []);
  assert.equal(h2.length, 1);
  // 9000x1 也一样
  assert.equal(precheckImages([image({ width: 9000, height: 1 })]).held.length, 1);
});

// 限内的正常图不受影响。
test("an image within the limit is sent as usual", () => {
  const ok = image({ width: 800, height: 600 });
  const { sendable, held } = precheckImages([ok]);
  assert.deepEqual(sendable.map((v) => v.name), ["IMG_2696.JPG"]);
  assert.deepEqual(held, []);
  // 正好等于上限也不算超
  assert.equal(precheckImages([image({ width: 8000, height: 8000 })]).held.length, 0);
});

// 量不出尺寸的图照常发送（不猜、不误拦）。
test("an image whose size is unknown is still sent", () => {
  const unknown = image({});
  assert.deepEqual(precheckImages([unknown]).held, []);
  assert.deepEqual(precheckImages([unknown]).sendable.map((v) => v.name), ["IMG_2696.JPG"]);
  // 坏头也要能由 bytesOf 回退测量，且量不出来就走"照发"
  const bad = image({ bytes: Buffer.alloc(16, 3) });
  const { sendable, held } = precheckImages([bad], { bytesOf: (v) => v.bytes });
  assert.deepEqual(held, []);
  assert.equal(sendable.length, 1);
  // 而给字节就能量出来 ⇒ 该拦的还是要拦
  const tall = image({ bytes: pngHeader(1179, 17728) });
  const held2 = precheckImages([tall], { bytesOf: (v) => v.bytes }).held;
  assert.equal(held2.length, 1);
  assert.equal(held2[0].width, 1179);
  assert.equal(held2[0].height, 17728);
});

// 尺寸本身靠谱：用真尺寸解析器喂进来的值也要被同样判断。
test("works on values measured from real headers", () => {
  const measured = imageSizeFromHeader(pngHeader(1179, 17728));
  const value = image({ width: measured.width, height: measured.height });
  assert.equal(precheckImages([value]).held.length, 1);
});

// 提示必须点名附件、尺寸、上限、原因与"不要重试上传"，且中英成对。
test("the notice names the file, its size, the limit and what to do instead", () => {
  const held = precheckImages([image({ width: 1179, height: 17728 })]).held[0];
  const zh = heldImageNotice(held, true);
  assert.match(zh, /IMG_2696\.JPG/);
  assert.match(zh, /1179×17728 px/);
  assert.match(zh, /8000 px/);
  assert.match(zh, /没有发送/);
  assert.match(zh, /不要重试上传/);
  assert.match(zh, /本机识别/);
  const en = heldImageNotice(held, false);
  assert.match(en, /IMG_2696\.JPG/);
  assert.match(en, /1179×17728 px/);
  assert.match(en, /was not sent/);
  assert.match(en, /Do not retry the upload/);
  assert.match(en, /read it locally/);
  // agent 侧那一句也要说清"没发出去、别重试"
  const forAgent = heldImageNoteForAgent(held);
  assert.match(forAgent, /NOT sent/);
  assert.match(forAgent, /do not retry the upload/i);
  assert.match(forAgent, /IMG_2696\.JPG/);
});

// 空输入与垃圾输入不能崩。
test("handles empty and junk input", () => {
  assert.deepEqual(precheckImages([]), { sendable: [], held: [] });
  assert.deepEqual(precheckImages(undefined), { sendable: [], held: [] });
  assert.deepEqual(precheckImages([null]).held, []);
  assert.deepEqual(precheckImages([null]).sendable, [null]);
});

// 被扣下的图必须当面告诉读者：哪张、多大、为什么、下一步怎么做。
test("a held image produces a notice naming the file, its size, the limit and what to do", () => {
  const held = precheckImages([image({ width: 1179, height: 17728 })]).held;
  const payload = heldAttachmentNoticePayload(held);
  assert.ok(payload, "a held image must produce a notice");
  assert.match(payload.notice, /IMG_2696\.JPG/);
  assert.match(payload.notice, /1179×17728 px/);
  assert.match(payload.notice, /8000 px/);
  assert.match(payload.notice, /没有发送/);
  assert.match(payload.notice, /不要重试上传/);
  assert.match(payload.notice, /本机识别/);
  // 双语成对（uiLocaleCoverage 会抓中文没配英文）
  assert.match(payload.noticeEnglish, /IMG_2696\.JPG/);
  assert.match(payload.noticeEnglish, /1179×17728 px/);
  assert.match(payload.noticeEnglish, /was not sent/);
  assert.match(payload.noticeEnglish, /Do not retry the upload/);
});

// held 为空 ⇒ 不许发事件（不刷屏）。
test("nothing held means no notice at all", () => {
  assert.equal(heldAttachmentNoticePayload([]), null);
  assert.equal(heldAttachmentNoticePayload(undefined), null);
  assert.equal(heldAttachmentNoticePayload(null), null);
  assert.equal(heldAttachmentNoticePayload([null, undefined]), null);
  // 限内的图 ⇒ precheck 不扣 ⇒ 也就没有通知
  assert.equal(heldAttachmentNoticePayload(precheckImages([image({ width: 800, height: 600 })]).held), null);
});
