import { ArrowUpRight, MessageSquareReply, X } from 'lucide-react'
import { t } from '@/lib/uiLocale'
import type { CrossConversationNotice as CrossConversationNoticeEntry } from '@/composables/useConversations'

interface CrossConversationNoticeProps {
  notice: CrossConversationNoticeEntry
  onOpen: (sourceId: string) => void
  onDismiss: (id: string) => void
}

/**
 * 搬运自本地分支（C）：另一个对话交过来的一条提示。
 *
 * 它是一条只读的转写条目 —— 一直留着直到读者关掉，只显示"谁写的、什么类型、什么时候"，
 * 唯一的动作是"打开来源"和"关闭"。它是通知，不是审批：没有同意/拒绝，没有要你决定的事。
 */
export function CrossConversationNotice({
  notice,
  onOpen,
  onDismiss,
}: CrossConversationNoticeProps) {
  const kindLabel = notice.kind === 'not-applied'
    ? t('未送达', 'Not delivered')
    : notice.kind === 'result'
      ? t('已回复', 'Replied')
      : t('已投递', 'Delivered')
  const timeLabel = (() => {
    const at = Number(notice.at ?? 0)
    if (!at) return ''
    const date = new Date(at)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  })()
  return (
    <div
      className="mx-auto mb-2 w-[72%]"
      data-testid="cross-conversation-notice"
      data-notice-source={notice.sourceId}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-control">
        <MessageSquareReply className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          data-testid="cross-conversation-notice-open"
          aria-label={t(
            `打开来源会话「${notice.sourceTitle}」`,
            `Open the source conversation: ${notice.sourceTitle}`,
          )}
          onClick={() => onOpen(notice.sourceId)}
        >
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="min-w-0 truncate font-medium">{notice.sourceTitle}</span>
            <span className="shrink-0 text-muted-foreground">·</span>
            <span className="shrink-0 text-muted-foreground">{kindLabel}</span>
            {notice.count > 1 ? (
              <span className="shrink-0 text-muted-foreground" data-testid="cross-conversation-notice-count">
                ×{notice.count}
              </span>
            ) : null}
            <span className="shrink-0 text-caption text-muted-foreground">{timeLabel}</span>
            <ArrowUpRight className="size-3.5 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
          </span>
          {notice.summary ? (
            <span
              className="mt-0.5 block truncate text-caption text-muted-foreground"
              data-testid="cross-conversation-notice-summary"
            >
              {notice.summary}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
          data-testid="cross-conversation-notice-dismiss"
          aria-label={t('关闭这条提示', 'Dismiss this notice')}
          onClick={() => onDismiss(notice.id)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
