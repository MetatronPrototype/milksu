import { describe, expect, it, vi } from 'vitest'
import { attachmentPixelSize, rememberAttachmentPixels } from '@/lib/attachmentPixelCache'

describe('attachment pixel cache', () => {
  // chip 与消息附件共用同一个 key ⇒ 量一次、两处都能显示。
  it('remembers a measured size under the attachment key', async () => {
    expect(attachmentPixelSize('a1:IMG_2696.JPG')).toBeNull()
    await rememberAttachmentPixels('a1:IMG_2696.JPG', new Blob(['x']), async () => ({ width: 1179, height: 17728 }))
    expect(attachmentPixelSize('a1:IMG_2696.JPG')).toEqual({ width: 1179, height: 17728 })
  })

  // 同一张图不许反复解码（每轮都量会拖慢输入框）。
  it('measures a key only once', async () => {
    const decode = vi.fn(async () => ({ width: 10, height: 20 }))
    await rememberAttachmentPixels('once-1', new Blob(['x']), decode)
    await rememberAttachmentPixels('once-1', new Blob(['x']), decode)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  // 量不到（HEIC/坏文件/没有解码器）⇒ 什么都不记 ⇒ 调用方不显示尺寸，不会出现 0×0/未知。
  it('caches nothing when the size cannot be measured', async () => {
    await rememberAttachmentPixels('heic-1', new Blob(['x']), async () => { throw new Error('unsupported image') })
    expect(attachmentPixelSize('heic-1')).toBeNull()
    await rememberAttachmentPixels('zero-1', new Blob(['x']), async () => ({ width: 0, height: 0 }))
    expect(attachmentPixelSize('zero-1')).toBeNull()
    await rememberAttachmentPixels('', new Blob(['x']), async () => ({ width: 5, height: 5 }))
    expect(attachmentPixelSize('')).toBeNull()
  })

  // 默认解码器在 jsdom 里不存在 ⇒ 静默不显示，绝不抛。
  it('stays silent when no decoder is available', async () => {
    await expect(rememberAttachmentPixels('none-1', new Blob(['x']))).resolves.toBeUndefined()
    expect(attachmentPixelSize('none-1')).toBeNull()
  })
})
