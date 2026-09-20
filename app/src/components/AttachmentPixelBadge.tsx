import { formatAttachmentSize as formatAttachmentPixels } from '@/lib/attachmentDimensions'
import { useAttachmentPixelSize } from '@/lib/attachmentPixelCache'

/**
 * 附件的像素尺寸徽标（输入框 chip 与消息附件共用同一处）。
 *
 * 尺寸来自**导入那一刻**用调用方已有的 File/Blob 量一次的共享缓存，所以：
 *  - 不在渲染期读图（不重复解码 ✗，也不阻塞输入框 ✗）；
 *  - 量不到 / 未就绪 ⇒ **什么都不渲染** ✓（绝不出现 `0×0`、`未知`、转圈占位 ✗）。
 */
export function AttachmentPixelBadge({ attachmentKey }: { attachmentKey: string }) {
  const pixels = useAttachmentPixelSize(attachmentKey)
  const label = pixels ? formatAttachmentPixels(pixels) : ''
  if (!label) return null
  return <span className="shrink-0 text-muted-foreground">{label}</span>
}

export default AttachmentPixelBadge
