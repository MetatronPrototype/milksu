/**
 * 附件图片的像素尺寸（app 侧，只用于显示）。
 *
 * 侧车已经把尺寸交给模型了（描述行里有 `1179×17728 px`），但读者在输入框和消息里看不到，
 * 于是"这张会不会被服务端拒"只能靠撞墙。这里补上显示用的那一半。
 *
 * 三条硬约束（都来自用户红线）：
 *  1) **不许压缩/降采样** —— 这里只读尺寸，绝不改动或重编码图片（OCR 要原分辨率）；
 *  2) **不许阻塞输入框** —— 量不出来就返回 null，调用方不显示尺寸，不显示 `0×0`/`未知`/占位；
 *  3) **不重复读图** —— 只接受调用方已有的 File/Blob（通常是它已经拿着的那份），不自己再取一遍。
 */

export type AttachmentPixelSize = { width: number; height: number }

/** 只在两个数都可信时才认为量到了；`0×0` 之类的噪音一律当作没量到。 */
export function normalizePixelSize(width: unknown, height: unknown): AttachmentPixelSize | null {
  const w = Math.floor(Number(width))
  const h = Math.floor(Number(height))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { width: w, height: h }
}

/** 显示用的短形式：`1179×17728`（不带宽高单位后缀，配合现有排版风格）。 */
export function formatAttachmentSize(size: AttachmentPixelSize | null | undefined): string {
  const normalized = normalizePixelSize(size?.width, size?.height)
  return normalized ? `${normalized.width}×${normalized.height}` : ''
}

type DecodeBitmap = (source: Blob) => Promise<{ width: number; height: number; close?: () => void }>

/**
 * 量一张图片的尺寸。任何失败都返回 null（不抛、不占位）：
 * HEIC 等浏览器/Electron 解不了的格式、坏的 blob、解码被中断 —— 一律"没有尺寸"。
 */
export async function measureAttachmentSize(
  source: Blob | null | undefined,
  decode: DecodeBitmap | undefined = typeof createImageBitmap === 'function'
    ? (blob: Blob) => createImageBitmap(blob)
    : undefined,
): Promise<AttachmentPixelSize | null> {
  if (!source || typeof decode !== 'function') return null
  let bitmap: { width: number; height: number; close?: () => void } | undefined
  try {
    bitmap = await decode(source)
    return normalizePixelSize(bitmap?.width, bitmap?.height)
  } catch {
    // HEIC / 私有不支持格式 / 解码失败：留空就好，不打扰读者。
    return null
  } finally {
    // 及时释放，避免为大图多留一份位图（约束 3）。
    try { bitmap?.close?.() } catch { /* 释放失败不影响结果 */ }
  }
}
