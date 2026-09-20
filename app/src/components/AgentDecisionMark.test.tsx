// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AgentDecisionMark from '@/components/AgentDecisionMark'

afterEach(cleanup)

// 用户要的形态：「完全一样的，原本的九格，但是点阵方形绕一圈并且黄色」
// ⇒ 沿用 AgentPixelLoader 的像素格语言，3×3 但中心留空（= 8 格绕成一圈），琥珀色。
describe('needs-decision mark', () => {
  it('draws eight amber cells and leaves the centre empty', () => {
    const { container } = render(<AgentDecisionMark />)
    const cells = container.querySelectorAll('.agent-decision-grid__cell')
    expect(cells).toHaveLength(8)
    // 中心必须留空：占位元素在、但没有格子。
    expect(container.querySelectorAll('.agent-decision-grid__hole')).toHaveLength(1)
    // 点阵共 9 个位置：8 格 + 1 空
    expect(container.querySelectorAll('.agent-decision-grid__cells > *')).toHaveLength(9)
    // 第 5 个位置（索引 4）就是中心 ⇒ 没有格子类
    const slots = container.querySelectorAll('.agent-decision-grid__cells > *')
    expect(slots[4]?.className).not.toContain('agent-decision-grid__cell')
  })

  it('is amber, using the repository token', () => {
    const { container } = render(<AgentDecisionMark />)
    for (const cell of container.querySelectorAll('.agent-decision-grid__cell')) {
      expect(cell.className).toMatch(/bg-amber-500\b/)
    }
  })

  // 与行内图标同尺寸（size-3.5 = 14px），否则那一行会跳。
  it('is as big as the sidebar row icons', () => {
    const { container } = render(<AgentDecisionMark />)
    expect(container.querySelector('.agent-decision-grid')?.className).toContain('size-3.5')
  })

  // 不许旧形态残留：圆环（border-2 + rounded-full）和更早的九格方阵都要消失。
  it('leaves no trace of the previous shapes', () => {
    const { container } = render(<AgentDecisionMark />)
    expect(container.querySelector('.agent-decision-ring__circle')).toBeNull()
    expect(container.querySelector('.agent-pixel--decision')).toBeNull()
    expect(container.querySelectorAll('.agent-pixel__cell')).toHaveLength(0)
    expect(container.querySelector('.rounded-full')).toBeNull()
    expect(container.querySelector('.border-2')).toBeNull()
  })

  it('announces itself as a status with a bilingual label', () => {
    render(<AgentDecisionMark />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('需要你决定')
    // 点阵对读屏是装饰（aria-hidden），文字由 role=status 的 aria-label 承担。
    expect(status.textContent).toBe('')
  })

  it('accepts a custom label', () => {
    render(<AgentDecisionMark label="Needs your decision" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Needs your decision')
  })
})
