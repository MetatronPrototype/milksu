import { describe, expect, it } from 'vitest'
import {
  chatAutoScrollThreshold,
  nextChatAutoScrollPinned,
  shouldFollowChatOutput,
} from './chatAutoScroll'

describe('chat auto scroll', () => {
  it('follows output while the user remains at or near the bottom', () => {
    expect(shouldFollowChatOutput(600, 400, 1000)).toBe(true)
    expect(shouldFollowChatOutput(
      600 - chatAutoScrollThreshold,
      400,
      1000,
    )).toBe(true)
  })

  it('stops following as soon as the user scrolls above the bottom threshold', () => {
    expect(shouldFollowChatOutput(
      600 - chatAutoScrollThreshold - 1,
      400,
      1000,
    )).toBe(false)
    expect(shouldFollowChatOutput(250, 400, 1000)).toBe(false)
  })

  it('stops on any upward user movement, even within the bottom threshold', () => {
    expect(nextChatAutoScrollPinned(600, 599, 400, 1000)).toBe(false)
    expect(nextChatAutoScrollPinned(599, 600, 400, 1000)).toBe(true)
  })

  it('resumes following once the reader scrolls back to the bottom', () => {
    // 往上翻 → 停止跟随（尊重读者）。
    expect(nextChatAutoScrollPinned(600, 520, 400, 1000)).toBe(false)
    // 往回滚到接近底部 → 必须恢复跟随。
    // 阈值曾经是 8：读者滚回来时停在几十像素处，这一格永远是 false，
    // 于是“跟随滚动”看起来根本没实现。
    expect(nextChatAutoScrollPinned(520, 1000 - 400 - 20, 400, 1000)).toBe(true)
  })

  it('treats a short viewport as already pinned to the bottom', () => {
    expect(shouldFollowChatOutput(0, 600, 400)).toBe(true)
  })
})
