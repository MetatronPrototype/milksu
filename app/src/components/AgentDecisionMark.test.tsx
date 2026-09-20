// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AgentDecisionMark from '@/components/AgentDecisionMark'

afterEach(cleanup)

describe('needs-decision mark', () => {
  // 复用运行中那套 9 格方阵：换标记时侧栏不会跳动。
  it('reuses the nine-cell grid and lights the question-mark cells', () => {
    const { container } = render(<AgentDecisionMark />)
    const cells = container.querySelectorAll('.agent-pixel__cell')
    expect(cells).toHaveLength(9)
    // "?" 的形状：第 1 行全亮 + 第 2 行最右 + 第 3 行中间 = 5 格
    expect(container.querySelectorAll('.agent-pixel__cell--decision-on')).toHaveLength(5)
    // 琥珀色这一层挂在容器上（颜色与缓慢呼吸都由 CSS 负责，不是每帧走 React）。
    expect(container.querySelector('.agent-pixel--decision')).not.toBeNull()
  })

  // 无障碍：这是状态，不是按钮；标签是"需要你决定"。
  it('announces itself as a status with the decision label', () => {
    render(<AgentDecisionMark />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('需要你决定')
    expect(status.textContent).toBe('')
  })

  it('accepts a custom label', () => {
    render(<AgentDecisionMark label="Needs your decision" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Needs your decision')
  })

  // 点亮的格子带的是"呼吸"动画类，而不是运行中那种快跳动画。
  it('breathes slowly instead of using the running animation', () => {
    const { container } = render(<AgentDecisionMark />)
    const on = container.querySelector('.agent-pixel__cell--decision-on')
    expect(on).not.toBeNull()
    expect(on?.className).not.toContain('agent-pixel__cell--on')
  })
})
