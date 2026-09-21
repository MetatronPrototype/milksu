import { useUiLocale } from '@/hooks/useUiLocale'

/**
 * 附件上的"已压缩"提示（只在后端给了文案时才出现）。
 *
 * 后端已经把中英两句都给了（"这张照片已压缩到 X MiB 才发得出去；原图在本地未改。" / 英文对应句），
 * 这里**按界面语言选一句**，不在前端重写 —— 免得两处措辞不一致。
 *
 * 未压缩的附件（含读者自己上传的文件、以及"压不下去所以放弃压缩"的那些）没有这个字段
 * ⇒ 什么都**不渲染**：绝不给正常附件加噪音。
 */
export default function AttachmentNotice({
  chinese,
  english,
}: {
  chinese?: string
  english?: string
}) {
  const locale = useUiLocale()
  const preferred = locale === 'en' ? english || chinese : chinese || english
  const text = String(preferred ?? '').trim()
  if (!text) return null
  return (
    <span className="agent-attachment-notice block text-caption text-muted-foreground" role="note">
      {text}
    </span>
  )
}
