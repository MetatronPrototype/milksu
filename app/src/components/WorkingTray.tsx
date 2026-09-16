import { useEffect, useMemo, useRef, useState } from 'react'
import { Square, X } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import { useT } from '@/hooks/useUiLocale'
import {
  liveWorkingItems,
  type WorkingItem,
} from '@/lib/workingRoster'
import type { Conversation } from '@/types'

export default function WorkingTray({
  items,
  conversations,
  onStopOne,
  onStopAll,
}: {
  items: readonly WorkingItem[]
  conversations: readonly Conversation[]
  onStopOne?: (item: WorkingItem) => void
  onStopAll?: () => void
}) {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [dismissedKey, setDismissedKey] = useState('')
  const [viewingId, setViewingId] = useState('')
  const [viewingItem, setViewingItem] = useState<WorkingItem | null>(null)
  const live = useMemo(() => liveWorkingItems(items), [items])
  const liveKey = live.map(item => item.id).join('\0')
  const viewing = conversations.find(item => item.id === viewingId) ?? null
  const viewingOpen = Boolean(viewing || viewingItem)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!live.length || dismissedKey === liveKey) return null

  const title = live.length === 1
    ? live[0].title
    : t(`${live.length} 项进行中`, `${live.length} Working`)

  function statusLabel(item: WorkingItem) {
    if (item.status === 'succeeded') return t('成功', 'Succeeded')
    if (item.status === 'failed') return t('失败', 'Failed')
    return t('进行中', 'Working')
  }

  function openItem(item: WorkingItem) {
    setViewingItem(item)
    setViewingId(item.conversationId ?? '')
  }

  return (
    <div ref={root} className="agent-thread relative mb-2">
      {open ? (
        <div
          className="absolute inset-x-0 bottom-[calc(100%+8px)] z-50 max-h-[min(18rem,calc(100vh-10rem))] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
          role="dialog"
          aria-label={t('进行中', 'Working')}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-label font-medium">{t('进行中', 'Working')}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-caption"
              onClick={() => onStopAll?.()}
            >
              {t('全部停止', 'Stop all')}
            </Button>
          </div>
          <ul>
            {items.map(item => (
              <li key={item.id}>
                <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openItem(item)}
                  >
                    <span className="block truncate text-label">{item.title}</span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {statusLabel(item)}
                    </span>
                  </button>
                  {item.status === 'running' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={!item.stoppable && items.every(entry => !entry.stoppable)}
                      aria-label={item.stoppable
                        ? t('停止此项', 'Stop this')
                        : t('全部停止', 'Stop all')}
                      onClick={() => {
                        if (item.stoppable) onStopOne?.(item)
                        else onStopAll?.()
                      }}
                    >
                      <Square className="size-3 fill-current" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-popover px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-label hover:bg-accent"
          aria-expanded={open}
          aria-label={t('进行中', 'Working')}
          onClick={() => setOpen(current => !current)}
        >
          <AgentPixelLoader label={t('进行中', 'Working')} running />
          <span className="min-w-0 truncate font-medium">{title}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-caption"
          onClick={() => onStopAll?.()}
        >
          {t('全部停止', 'Stop all')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t('关闭', 'Close')}
          onClick={() => {
            if (open) {
              setOpen(false)
              return
            }
            setDismissedKey(liveKey)
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <Dialog
        open={viewingOpen}
        onOpenChange={next => {
          if (!next) {
            setViewingId('')
            setViewingItem(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.title || viewingItem?.title || t('子代理', 'Subagent')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('查看这个子代理正在跑的对话', 'View this subagent conversation')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(24rem,calc(100vh-12rem))] space-y-3 overflow-y-auto px-1 py-2">
            {(viewing?.messages ?? []).length ? (viewing?.messages ?? []).map(message => (
              <div key={message.id} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="mb-1 text-caption text-muted-foreground">
                  {message.role === 'user'
                    ? t('你', 'You')
                    : message.role === 'tool'
                      ? (message.toolName || t('工具', 'Tool'))
                      : t('子代理', 'Subagent')}
                </p>
                <pre className="whitespace-pre-wrap break-words font-sans text-label">
                  {message.content}
                </pre>
              </div>
            )) : (
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <p className="mb-1 text-caption text-muted-foreground">
                  {viewingItem ? statusLabel(viewingItem) : t('子代理', 'Subagent')}
                </p>
                <pre className="whitespace-pre-wrap break-words font-sans text-label">
                  {viewingItem?.detail || viewingItem?.title || ''}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
