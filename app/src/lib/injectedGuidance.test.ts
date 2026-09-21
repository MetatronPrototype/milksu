import { describe, expect, it } from 'vitest'
import {
  injectedGuidanceTexts,
  settleInjectedGuidance,
  type InjectedGuidanceEntry,
} from '@/lib/injectedGuidance'

// 语义：「已加入本轮」表示"这些引导并入了**那一轮**" ⇒ 只应在**它所属的那一轮**结束时消失。
describe('injected guidance settles by the turn it belongs to', () => {
  const duringTurn = (text: string, at: number): InjectedGuidanceEntry => ({ text, at })

  // ① 回合进行中注入 ⇒ 该回合结束 ⇒ 提示消失（保持既有行为）。
  it('clears an entry injected during the turn that just ended', () => {
    expect(settleInjectedGuidance([duringTurn('并进本轮', 1_000)], 2_000)).toEqual([])
  })

  // ② 回合刚结束之后注入 ⇒ 立刻模拟"上一轮的结束" ⇒ **必须还在**（这正是用户报的"不显示"）。
  it('keeps an entry injected after that turn had already ended', () => {
    const kept = settleInjectedGuidance([duringTurn('晚一步加入', 3_000)], 2_000)
    expect(kept).toHaveLength(1)
    expect(injectedGuidanceTexts(kept)).toEqual(['晚一步加入'])
  })

  // ③ 它所属的下一轮结束时 ⇒ 才消失。
  it('clears it only when its own turn ends', () => {
    const afterFirst = settleInjectedGuidance([duringTurn('晚一步加入', 3_000)], 2_000)
    expect(afterFirst).toHaveLength(1)
    // 下一轮在 5_000 结束 ⇒ 这条（3_000 注入）属于那一轮 ⇒ 清掉。
    expect(settleInjectedGuidance(afterFirst, 5_000)).toEqual([])
  })

  // 混合：只清属于刚结束那一轮的，晚的那条留着。
  it('clears only the entries that belong to the finished turn', () => {
    const entries = [duringTurn('早的', 1_000), duringTurn('晚的', 3_000)]
    expect(injectedGuidanceTexts(settleInjectedGuidance(entries, 2_000))).toEqual(['晚的'])
  })

  // ④ 文本契约没变（回声过滤按文本工作）。
  it('still exposes plain texts for the echo filter', () => {
    expect(injectedGuidanceTexts([duringTurn('a', 1), { text: 'b' }])).toEqual(['a', 'b'])
    expect(injectedGuidanceTexts(undefined)).toEqual([])
  })

  // 退化策略：拿不到结束时刻 ⇒ **本次不清**（绝不许退化成"全清"，那正是这个 bug）。
  it('never degrades into clearing everything when the end time is unknown', () => {
    const entries = [duringTurn('x', 1_000)]
    expect(settleInjectedGuidance(entries, undefined)).toBe(entries)
    expect(settleInjectedGuidance(entries, Number.NaN)).toBe(entries)
    // 条目自身缺时刻 ⇒ 无法证明它属于"之后的那一轮" ⇒ 按已结束处理（与旧行为一致）。
    expect(settleInjectedGuidance([{ text: 'legacy' }], 2_000)).toEqual([])
    expect(settleInjectedGuidance([], 2_000)).toEqual([])
    expect(settleInjectedGuidance(undefined, 2_000)).toEqual([])
  })
})
