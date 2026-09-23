import { useEffect, useMemo, useState } from 'react'
import AgentBackgroundTaskMark from '@/components/AgentBackgroundTaskMark'
import {
  BACKGROUND_STRIP_SETTLED_MS,
  backgroundStripDigest,
  type BackgroundTaskLike,
  type BackgroundTaskOutcome,
} from '@/lib/backgroundStripDigest'
import { t } from '@/lib/uiLocale'

/**
 * 输入框上方的「后台任务」窄带：把**在跑什么**和**结果**说清楚（用户要求：整合进这条窄带）。
 *
 * - 有在跑 ⇒ 四行：①标记 +「后台任务进行中」 ②「N 件 · 名字（还有 M 件）」 ③「进行中」 ④「请不要关机」
 * - 没有在跑但有终态 ⇒ ①标记 +「N 件 · 名字（还有 M 件）」+ 终态那行，**10 秒后自动收起**
 * - 终态显示期间又开始新任务 ⇒ 立刻切回"进行中"，并清掉收起定时器
 * - 数据显示的是**事实**：件数与名字来自任务列表本身；**没有百分比**（数据里没有），不许编。
 *
 * 事实口径全在 `backgroundStripDigest`（纯函数、有测试）；这里只负责文字与计时。
 */
export function BackgroundTaskStrip({
  running,
  outcome,
}: {
  running?: BackgroundTaskLike[] | null
  outcome?: BackgroundTaskOutcome | null
}) {
  const [now, setNow] = useState(() => Date.now())
  const digest = useMemo(() => backgroundStripDigest({ running, outcome, now }), [running, outcome, now])

  // 终态要在 10 秒后自己收起；定时器在卸载、切换会话（props 变化）时都必须清掉，不许泄漏。
  useEffect(() => {
    if (digest.mode !== 'settled' || !digest.visible) return undefined
    setNow(Date.now())
    const remaining = Math.max(0, (outcome?.at ?? 0) + BACKGROUND_STRIP_SETTLED_MS - Date.now())
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 50)
    return () => window.clearTimeout(timer)
  }, [digest.mode, digest.visible, outcome?.at, running])

  if (!digest.visible) return null

  const countLine = digest.moreCount > 0
    ? t(
      `${digest.count} 件 · ${digest.firstName}（还有 ${digest.moreCount} 件）`,
      `${digest.count} · ${digest.firstName} (${digest.moreCount} more)`,
    )
    : t(
      `${digest.count} 件 · ${digest.firstName}`,
      `${digest.count} · ${digest.firstName}`,
    )
  const statusLine = digest.statusKind === 'failed'
    ? t('失败', 'Failed')
    : digest.statusKind === 'cancelled'
      ? t('已取消', 'Cancelled')
      : digest.statusKind === 'completed'
        ? t('已完成', 'Completed')
        : t('进行中', 'Running')

  return (
    <div
      className="chat-composer__background-strip flex flex-col gap-0.5 px-1 pb-1 text-xs text-muted-foreground"
      data-testid="background-task-strip"
      data-mode={digest.mode}
    >
      <div className="flex items-center gap-2">
        <AgentBackgroundTaskMark />
        {digest.mode === 'running' ? <span>{t('后台任务进行中', 'Background task running')}</span> : null}
      </div>
      <span>{countLine}</span>
      <span>{statusLine}</span>
      {digest.mode === 'running' ? <span>{t('请不要关机', 'Please do not shut down')}</span> : null}
    </div>
  )
}
