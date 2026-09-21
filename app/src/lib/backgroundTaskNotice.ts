/**
 * 「回合结束了，但仍有后台任务在跑」该不该提示、提示哪一种（**纯判定 ✓**，可测 ✓）。
 *
 * 用户的原话（产品缺陷 ✓）：「你发出"正在打包"的消息后自己结束了，但是我能看到背景确实在打包…
 * 如果你还有东西在跑那就不要结束任务，至少给点提示说还在运行什么什么东西，不然这会误导用户以为
 * 任务结束了，如果直接关机就会造成中断了。」
 * ⇒ 规则 ✓：**回合结束时若仍有后台任务** ⇒ 必须**用文字说清在跑什么** ✓（不是小图标 ✗）+ **别关机** ✓；
 *   **跑完** ⇒ 再给一条"已完成"✓（否则读者一直以为还在跑 ✗）；**没有后台任务** ⇒ **什么都不提示** ✗。
 *
 * ⚠️ 这里**不出文案** ✓：仓库约定所有面向用户的文字都要经组件的 `t(中文, English)` 成对出现
 * （`uiLocaleCoverage` 会抓 ✗ —— 我已被它教育过两次 ✓）。所以只给**结构化事实** ✓，句子由调用方拼 ✓。
 */

export type BackgroundTaskNotice =
  /** `turnEnded` 让调用方能把话说明白（"回合结束了，但仍在跑"比"仍在跑"更准确 ✓）。 */
  | { kind: 'still-running'; name: string; count: number; turnEnded: boolean }
  | { kind: 'finished' }

/**
 * @param turnEnded  这一轮是否已经结束（回合结束时才需要提示"还在跑"✓）
 * @param running    当前仍在跑的后台任务（**要有名字** ✓ —— 用户要求"说清在跑什么"✓）
 * @param hadRunning 之前是否报告过"有后台任务在跑"（用来决定"跑完了"该不该说一声 ✓）
 */
export function backgroundTaskNotice({
  turnEnded,
  running,
  hadRunning = false,
}: {
  turnEnded: boolean
  running?: Array<{ name?: unknown }> | null
  hadRunning?: boolean
}): BackgroundTaskNotice | null {
  const tasks = Array.isArray(running) ? running.filter(Boolean) : []
  const names = tasks
    .map(task => String(task?.name ?? '').trim())
    .filter(name => name.length > 0)
  if (names.length > 0) {
    // 仍在跑：**不管回合有没有结束**都该让读者看见（结束了更要紧：他会以为完事了 ✗）。
    return { kind: 'still-running', name: names[0] as string, count: names.length, turnEnded: Boolean(turnEnded) }
  }
  // 没有在跑的了：只在"之前报告过在跑"时才说一声"已完成"（否则会无中生有 ✗）。
  if (hadRunning) return { kind: 'finished' }
  return null
}
