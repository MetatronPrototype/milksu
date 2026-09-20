import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preparePromptAttachments } from "./bridge-attachments.js";

// 与 bridge-attachments.test.js 里那个能跑通的夹具同形状（id 必须是 sha256 本身）。
async function fixture(name, content, mediaType = "image/png") {
  const root = await mkdtemp(join(tmpdir(), "milksu-coding-attachments-"));
  const data = Buffer.from(content);
  const sha256 = createHash("sha256").update(data).digest("hex");
  await mkdir(join(root, sha256), { recursive: true, mode: 0o700 });
  await writeFile(join(root, sha256, name), data, { mode: 0o600 });
  return {
    root,
    attachment: { id: sha256, sha256, name, mediaType, size: data.length },
  };
}

// 一张"极小但超限"的 PNG：1x9000，几十字节。正是会被服务端拒的那种图。
function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

// 事故根：超限的图一旦进了交给 pi 的 images，pi 就会把它写进 session .jsonl ⇒ 之后每轮重放
// ⇒ 整条会话永久 400。所以这里必须断言它根本不进 images。
test("an oversized image never reaches the model request", async () => {
  const { root, attachment } = await fixture("long.png", pngHeader(1, 9000));
  const result = await preparePromptAttachments([attachment], root);
  // 接线前这里是 1（图被塞进去了）—— 这就是那条真红。
  assert.equal(result.images.length, 0);
});

// 文件仍要被列出来，但必须写明"没发出去"，否则 agent 会一直等一个不会发生的上传。
test("the held image is reported as not sent, with its size", async () => {
  const { root, attachment } = await fixture("long.png", pngHeader(1, 9000));
  const result = await preparePromptAttachments([attachment], root);
  assert.match(result.context, /long\.png/);
  assert.match(result.context, /NOT sent to the model/);
  assert.match(result.context, /1×9000 px/);
  assert.match(result.context, /8000 px limit/);
  assert.match(result.context, /do not retry the upload/i);
  assert.equal(result.held.length, 1);
  assert.equal(result.held[0].name, "long.png");
});

// 限内的图照常发送，别误拦。
test("an image within the limit is still sent", async () => {
  const { root, attachment } = await fixture("ok.png", pngHeader(800, 600));
  const result = await preparePromptAttachments([attachment], root);
  assert.equal(result.images.length, 1);
  assert.equal(result.held.length, 0);
});
