import { t } from '@/lib/uiLocale'

/**
 * 状态区那一行：「后台仍在运行：N 件 · <名字>」（双语）。
 *
 * 为什么单独抽成组件：它只吃一个**事实**数组 ✓ ⇒ 能在不渲染整个侧栏的前提下断言 ✓
 * （渲染 `ContextSidebar` 会拉起图标依赖 ⇒ 本 worktree 的符号链接 `node_modules` 会让 `?raw` 被拒 ✗）。
 *
 * 规则（用户的原话要求）：**有后台任务在跑时，状态区不许只显示"已结束"** ✗；
 * **没有任务时**这一行**不出现** ✗（`null`，不留空壳 ✓）。
 */
export interface BackgroundTaskLineTask {
  id?: string
  name?: string
  status?: string
}

export function BackgroundTaskLine({ tasks }: { tasks?: BackgroundTaskLineTask[] }) {
  const running = (Array.isArray(tasks) ? tasks : []).filter(task => Boolean(task))
  if (running.length === 0) return null
  const name = String(running[0]?.name ?? '').trim()
  const count = running.length
  const label = count > 1
    ? t(`后台仍在运行：${count} 件 · ${name}`, `Still running in the background: ${count} · ${name}`)
    : t(`后台仍在运行：${count} 件 · ${name}`, `Still running in the background: ${count} · ${name}`)
  return (
    <span className="coding-session-background-task" role="note" data-testid="background-task-line">
      {label}
    </span>
  )
}
