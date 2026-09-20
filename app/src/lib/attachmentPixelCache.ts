/**
 * 附件像素尺寸的共享缓存（chip 与消息附件共用）。
 *
 * 为什么要共享：同一条附件在输入框 chip 上和发出后的消息里都要显示尺寸，但**量尺寸只该发生一次**，
 * 而且只能在"手上真的拿着那个 blob 的那一刻"量 —— 也就是添加附件的时候。之后不管界面上有几处
 * 渲染它，都只读缓存。
 *
 * 约束（沿用 `attachmentDimensions` 的红线）：不压缩/不降采样 ✗、量不到就不显示 ✓（无 `0×0`/占位 ✗）、
 * 不重复读图 ✗（只在导入那一刻用调用方已有的 File/Blob 量一次 ✓）。
 */

import { useSyncExternalStore } from 'react'
import { measureAttachmentSize, type AttachmentPixelSize } from '@/lib/attachmentDimensions'

type DecodeBitmap = Parameters<typeof measureAttachmentSize>[1]

const cache = new Map<string, AttachmentPixelSize>()
const listeners = new Set<() => void>()
/** 已经量过（含"量不出"）的 key：避免同一张图反复解码。 */
const attempted = new Set<string>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 读缓存；没有就返回 null（调用方据此**不显示**尺寸）。 */
export function attachmentPixelSize(key: string): AttachmentPixelSize | null {
  return cache.get(key) ?? null
}

/**
 * 用调用方此刻已有的 File/Blob 量一次尺寸并记住。失败/量不出 ⇒ 什么都不记（不显示尺寸）。
 * 同一 key 只会尝试一次；返回 Promise 但调用方**不需要 await**（不许阻塞输入框 ✗）。
 */
export async function rememberAttachmentPixels(
  key: string,
  source: Blob | null | undefined,
  decode?: DecodeBitmap,
) {
  if (!key || attempted.has(key)) return
  attempted.add(key)
  const size = await measureAttachmentSize(source, decode)
  if (!size) return
  cache.set(key, size)
  emit()
}

/** 组件里读某个附件的尺寸（订阅式，量好了会自动重渲染那一处）。 */
export function useAttachmentPixelSize(key: string): AttachmentPixelSize | null {
  return useSyncExternalStore(
    subscribe,
    () => cache.get(key) ?? null,
    () => cache.get(key) ?? null,
  )
}
