import assert from "node:assert/strict";
import test from "node:test";
import { formatAttachmentLine, formatPixelSize } from "./bridge-attachment-line.js";

const describeBytes = (size) => `${(Number(size) / (1024 * 1024)).toFixed(1)} MiB`;
const base = {
  name: "IMG_2696.JPG",
  mediaType: "image/jpeg",
  size: 3.7 * 1024 * 1024,
  sha256: "19a13f27",
  path: "/tmp/IMG_2696.JPG",
};

// 真机那张：agent 只有先知道 1179x17728，才能预判"会被服务端拒"。
test("the description carries the pixel size of an image", () => {
  const line = formatAttachmentLine({ ...base, width: 1179, height: 17728 }, { describeBytes });
  assert.equal(
    line,
    "- IMG_2696.JPG (image/jpeg, 3.7 MiB, 1179×17728 px, sha256:19a13f27, read-only path: /tmp/IMG_2696.JPG)",
  );
  assert.match(line, /1179×17728 px/);
});

// 量不出来就保持原样：不能因为多了一个字段就把这行弄坏。
test("without dimensions the line is exactly what it used to be", () => {
  const line = formatAttachmentLine(base, { describeBytes });
  assert.equal(
    line,
    "- IMG_2696.JPG (image/jpeg, 3.7 MiB, sha256:19a13f27, read-only path: /tmp/IMG_2696.JPG)",
  );
  assert.doesNotMatch(line, /px/);
  // 半截尺寸（只有宽）也不显示
  assert.doesNotMatch(formatAttachmentLine({ ...base, width: 1179 }, { describeBytes }), /px/);
  assert.doesNotMatch(formatAttachmentLine({ ...base, width: 1179, height: 0 }, { describeBytes }), /px/);
});

test("pixel sizes are formatted or dropped, never guessed", () => {
  assert.equal(formatPixelSize(1179, 17728), "1179×17728 px");
  assert.equal(formatPixelSize(1, 1), "1×1 px");
  for (const bad of [[0, 10], [10, 0], [-1, 5], ["x", 5], [undefined, undefined], [null, null]]) {
    assert.equal(formatPixelSize(bad[0], bad[1]), "");
  }
});

// 非图片附件照样要有完整一行（尺寸留空），不能因为缺尺寸就少字段。
test("a non-image attachment still gets a complete line", () => {
  const line = formatAttachmentLine(
    { name: "notes.txt", mediaType: "text/plain", size: 1024, sha256: "abc", path: "/tmp/notes.txt" },
    { describeBytes },
  );
  assert.equal(line, "- notes.txt (text/plain, 0.0 MiB, sha256:abc, read-only path: /tmp/notes.txt)");
});
