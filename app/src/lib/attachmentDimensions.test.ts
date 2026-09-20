import { describe, expect, it, vi } from 'vitest'
import {
  formatAttachmentSize,
  measureAttachmentSize,
  normalizePixelSize,
} from '@/lib/attachmentDimensions'

describe('attachment dimensions', () => {
  it('formats a measured size the way the chip shows it', () => {
    expect(formatAttachmentSize({ width: 1179, height: 17728 })).toBe('1179×17728')
  })

  // 没量到就不显示 —— 不许出现 0×0 / 未知 这类噪音。
  it('renders nothing when the size is unknown', () => {
    expect(formatAttachmentSize(null)).toBe('')
    expect(formatAttachmentSize(undefined)).toBe('')
    expect(formatAttachmentSize({ width: 0, height: 0 })).toBe('')
    expect(formatAttachmentSize({ width: 0, height: 100 })).toBe('')
    expect(normalizePixelSize(0, 0)).toBeNull()
    expect(normalizePixelSize(-1, 5)).toBeNull()
    expect(normalizePixelSize('x', 5)).toBeNull()
  })

  // 真机那张：量出来了就报真尺寸（并且不压缩 —— 这里只读，不写回任何东西）。
  it('measures through the decoder and reports the real pixels', async () => {
    const decode = vi.fn(async () => ({ width: 1179, height: 17728, close: vi.fn() }))
    const size = await measureAttachmentSize(new Blob(['x']), decode)
    expect(size).toEqual({ width: 1179, height: 17728 })
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('closes the bitmap so a large image is not held twice', async () => {
    const close = vi.fn()
    await measureAttachmentSize(new Blob(['x']), async () => ({ width: 10, height: 20, close }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  // HEIC / 坏文件 / 没有解码器 ⇒ 一律 null（不抛、不占位、不卡住输入框）。
  it('returns null instead of throwing when the image cannot be decoded', async () => {
    await expect(measureAttachmentSize(new Blob(['x']), async () => {
      throw new Error('unsupported image')
    })).resolves.toBeNull()
    await expect(measureAttachmentSize(new Blob(['x']), async () => ({ width: 0, height: 0 })))
      .resolves.toBeNull()
    await expect(measureAttachmentSize(null, async () => ({ width: 1, height: 1 }))).resolves.toBeNull()
    await expect(measureAttachmentSize(new Blob(['x']), undefined as never)).resolves.toBeNull()
  })
})
