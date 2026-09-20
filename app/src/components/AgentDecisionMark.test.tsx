// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AgentDecisionMark from '@/components/AgentDecisionMark'

afterEach(cleanup)

// 用户真机反馈："不太可见啊，改成黄色圈吧" —— 小方阵在深色底上太碎，改成琥珀圆环。
describe('needs-decision mark', () => {
  it('renders an amber ring, not the old pixel grid', () => {
    const { container } = render(<AgentDecisionMark />)
    // 圆环：rounded-full + 较粗描边 + 琥珀色
    const ring = container.querySelector('.agent-decision-ring__circle')
    expect(ring).not.toBeNull()
    expect(ring?.className).toContain('rounded-full')
    expect(ring?.className).toContain('border-2')
    expect(ring?.className).toMatch(/border-amber-500\b/)
    // 旧形态（9 格像素方阵）必须彻底消失：那是"不够可见"的原因。
    expect(container.querySelectorAll('.agent-pixel__cell')).toHaveLength(0)
    expect(container.querySelector('.agent-pixel--decision')).toBeNull()
  })

  // 直径与侧栏其它行内图标一致（size-3.5 = 14px），否则换标记时那一行会跳。
  it('is as big as the sidebar row icons', () => {
    const { container } = render(<AgentDecisionMark />)
    expect(container.querySelector('.agent-decision-ring')?.className).toContain('size-3.5')
    expect(container.querySelector('.agent-decision-ring__circle')?.className).toContain('size-3.5')
  })

  // 可见性：除了描边，还有一层淡琥珀底与外发光（克制，不是刺眼闪烁）。
  it('adds a restrained fill and glow so it reads on a dark sidebar', () => {
    const { container } = render(<AgentDecisionMark />)
    const ring = container.querySelector('.agent-decision-ring__circle')
    expect(ring?.className).toMatch(/bg-amber-500\/15\b/)
  })

  it('announces itself as a status with a bilingual label', () => {
    render(<AgentDecisionMark />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-label')).toBe('需要你决定')
    // 环本身对读屏是装饰（aria-hidden），文本由 role=status 的 aria-label 承担。
    expect(status.textContent).toBe('')
  })

  it('accepts a custom label', () => {
    render(<AgentDecisionMark label="Needs your decision" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Needs your decision')
  })
})
