/**
 * 「已加入本轮」的注入记录：**每条带上它的注入时刻**。
 *
 * 为什么需要时刻：这块提示表示"这些引导并入了**那一轮**" ⇒ 它只应在**它所属的那一轮**结束时消失。
 * 旧写法（任何回合结束都清空整个列表）有个真机可见的坑：读者在**回合刚结束/正在结束**时点「加入对话」✗
 * ⇒ 追加上去后**立刻被清掉** ⇒ 提示不显示（用户报的"点了加入对话不显示"✓）。
 */

export type InjectedGuidanceEntry = {
  text: string
  /** 注入时刻（毫秒时间戳）。缺失/非法 ⇒ 当作"属于更早的、未知的那一轮"。 */
  at?: number
}

/**
 * 回合结束时，只清掉**属于刚结束那一轮**的条目：`at <= endedAt`。
 *
 * 退化策略（明确写清 ✓）：**结束时刻取不到（非有限数）⇒ 本次不清** ✓ —— 这比"退化成全清"安全
 * （全清正是上面那个 bug ✓）。条目自身缺 `at`（老数据/意外写入）时，因为无法证明它属于**之后的**那一轮，
 * 按"属于已结束的这一轮"处理 ⇒ 清掉（与旧行为一致，也符合"回合结束就该清掉"）。
 */
export function settleInjectedGuidance(
  entries: InjectedGuidanceEntry[] | undefined,
  endedAt: number | undefined,
): InjectedGuidanceEntry[] {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return list
  // 退化：拿不到结束时刻 ⇒ 本次不清（不许退化成全清）。
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return list
  return list.filter(entry => {
    const at = entry?.at
    if (typeof at !== 'number' || !Number.isFinite(at)) return false
    return at > endedAt
  })
}

/** 只给界面与回声过滤用的文本列表（保持既有契约：`string[]`）。 */
export function injectedGuidanceTexts(entries: InjectedGuidanceEntry[] | undefined): string[] {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => (typeof entry?.text === 'string' ? entry.text : ''))
    .filter(text => text.length > 0)
}
