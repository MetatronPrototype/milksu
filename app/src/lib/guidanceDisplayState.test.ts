import { describe, expect, it } from 'vitest'
import { guidanceDisplayState } from '@/lib/guidanceDisplayState'

describe('guidance display state', () => {
  // ① 工具还在跑 ⇒ 等待中（用户看到的就是这个：工具结束之后才真的加入）。
  it('is waiting while a tool is still running', () => {
    expect(guidanceDisplayState(true)).toBe('waiting')
  })

  // ② 工具结束 ⇒ 已加入。
  it('is joined once no tool is running any more', () => {
    expect(guidanceDisplayState(false)).toBe('joined')
  })

  // 文案不在这里（由组件用 t(中文, English) 提供，uiLocaleCoverage 会守约定）——
  // 这里只钉住"状态"本身，以及"等待中 ≠ 已加入"这条语义边界由状态决定。
  it('keeps waiting and joined as distinct states', () => {
    expect(guidanceDisplayState(true)).not.toBe(guidanceDisplayState(false))
  })
})
