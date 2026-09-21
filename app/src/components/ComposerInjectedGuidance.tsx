import { Check } from 'lucide-react'
import { useT } from '@/hooks/useUiLocale'
import { guidanceDisplayState } from '@/lib/guidanceDisplayState'

/**
 * 「读者插进来的引导」那块（从 `ChatComposer` 抽出来的独立组件 ✓）。
 *
 * 抽出来的原因 ✓：`ChatComposer` 一旦在测试里渲染就会连带拉进图标依赖 ⇒ 撞上这个 worktree 的
 * 符号链接 `?raw` 既有坑 ✗（`AttachmentPixelBadge` 那次用的是同一招 ✓）。这里依赖面很小 ⇒ 可测 ✓。
 *
 * **DOM 与文案与抽出来之前一字不变** ✓（同样的 `section` / 类名 / 文案 / 图标 ✓）：
 *  - 工具还在跑 ⇒ `waiting` ✓：**灰色小圆点**（不打勾 ✗）+「正在等待工具调用结束，结束后加入对话」✓ +
 *    标题「N 条引导等待加入」✓；
 *  - 工具结束 ⇒ `joined` ✓：现有 ✓ +「已加入本轮」✓ + 标题「N 条引导已加入本轮」✓。
 * **纯显示** ✓：不动排队/steering/闸门 ✓。
 */
export default function ComposerInjectedGuidance({
  messages,
  toolRunning,
}: {
  messages?: string[]
  toolRunning: boolean
}) {
  const t = useT()
  const list = Array.isArray(messages) ? messages : []
  if (!list.length) return null
  const waiting = guidanceDisplayState(toolRunning) === 'waiting'
  return (
    <section
      className="chat-composer__queued-guidance"
      aria-label={waiting
        ? t('等待加入本轮的引导', 'Steering waiting to join this turn')
        : t('已加入本轮的引导', 'Steering merged into this turn')}
    >
      <div className="flex items-center gap-2 text-caption font-medium text-muted-foreground">
        {waiting
          ? <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
          : <Check className="size-3.5" />}
        <span>{waiting
          ? t(`${list.length} 条引导等待加入`, `${list.length} steering messages are waiting to join`)
          : t(`${list.length} 条引导已加入本轮`, `${list.length} steering messages joined this turn`)}</span>
      </div>
      {list.map((message, index) => (
        <div key={`injected:${index}:${message}`} className="mt-1 flex items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-2 py-1.5">
          <p className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={message}>{message}</p>
          <span className="shrink-0 text-caption text-muted-foreground">
            {waiting
              ? t('正在等待工具调用结束，结束后加入对话', 'Waiting for the running tool to finish; it will join the conversation after that')
              : t('已加入本轮', 'Joined this turn')}
          </span>
        </div>
      ))}
    </section>
  )
}
