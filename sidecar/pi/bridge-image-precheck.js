// Refusing to send an image the provider will refuse, before it becomes history.
//
// A 1179x17728 screenshot got a 400 ("unsupported image") once - and because the message stayed in the
// history, every later turn re-sent it and the whole conversation was unusable until a human removed it
// by hand. The lesson is that an image which cannot be sent must never enter the turn or the history in
// the first place, and that the reader has to be told which file was left out and why.
//
// This is the decision half: which images may be sent, and the words for the ones that may not. Sizes
// come from bridge-image-size.js (a header read); an image we could not measure is NOT refused - an
// unknown size is not a reason to block a file, it is only a reason not to claim we know.

import { imageSizeFromHeader } from "./bridge-image-size.js";

/** Common provider ceiling; a side longer than this is refused before it is ever sent. */
export const MAX_IMAGE_SIDE = 8000

/** Reasons an image was held back, kept as data so callers can phrase them however they need. */
export const IMAGE_HELD_OVERSIZED = "oversized"

/**
 * Split attachments into the ones that may go into this turn and the ones that must not.
 * `values` are the attachment records (name, mediaType, sha256, and width/height when known).
 */
export function precheckImages(values = [], { maxSide = MAX_IMAGE_SIDE, sizeOf = imageSizeFromHeader, bytesOf } = {}) {
  const sendable = []
  const held = []
  for (const value of values) {
    let width = Number(value?.width)
    let height = Number(value?.height)
    // Fall back to measuring here when the caller has the bytes but not the dimensions yet.
    if ((!Number.isFinite(width) || !Number.isFinite(height)) && typeof bytesOf === "function") {
      const measured = sizeOf(bytesOf(value))
      if (measured) {
        width = measured.width
        height = measured.height
      }
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      // Unknown: send it anyway, and never guess a size for it.
      sendable.push(value)
      continue
    }
    const limit = Math.max(1, Math.floor(Number(maxSide) || MAX_IMAGE_SIDE))
    if (width > limit || height > limit) {
      held.push({ ...value, width, height, reason: IMAGE_HELD_OVERSIZED, limit })
      continue
    }
    sendable.push(value)
  }
  return { sendable, held }
}

/** What the reader is shown: which file, how big, why, and what to do instead. */
export function heldImageNotice(entry, chinese = false) {
  const name = String(entry?.name ?? "").trim() || "image"
  const width = Number(entry?.width) || 0
  const height = Number(entry?.height) || 0
  const limit = Number(entry?.limit) || MAX_IMAGE_SIDE
  return chinese
    ? `图片 ${name}（${width}×${height} px）没有发送：尺寸超过上限 ${limit} px。不要重试上传，请换一张图或改用本机识别。`
    : `Image ${name} (${width}×${height} px) was not sent: it is larger than the ${limit} px limit. Do not retry the upload; use a different image or read it locally instead.`
}

/** The same fact for the agent's result, so it stops waiting for an upload that will never happen. */
export function heldImageNoteForAgent(entry) {
  const name = String(entry?.name ?? "").trim() || "image"
  const width = Number(entry?.width) || 0
  const height = Number(entry?.height) || 0
  const limit = Number(entry?.limit) || MAX_IMAGE_SIDE
  return `- ${name}: NOT sent to the model (${width}×${height} px exceeds the ${limit} px limit). It was left out of this turn and out of the conversation history; do not retry the upload, read the file locally instead.`
}

/**
 * 被扣下的图要给读者一句**能照做**的话：附件名 + 尺寸 + 上限 + "不要重试上传" + "改用本机识别或换一张图"。
 * 中英成对（仓库有 uiLocaleCoverage 测试会抓中文没配英文）。`held` 为空 ⇒ 返回 null ⇒ 调用方**不发事件**
 * （不许刷屏）。
 */
export function heldAttachmentNoticePayload(held) {
  const entries = Array.isArray(held) ? held.filter(Boolean) : []
  if (!entries.length) return null
  return {
    notice: entries.map((entry) => heldImageNotice(entry, true)).join("\n"),
    noticeEnglish: entries.map((entry) => heldImageNotice(entry, false)).join("\n"),
  }
}
