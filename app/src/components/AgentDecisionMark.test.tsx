// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AgentDecisionMark from '@/components/AgentDecisionMark'

afterEach(cleanup)

// 用工作目录相对路径读源文件：jsdom 环境里 import.meta.url 不是 file 协议。
const css = readFileSync(resolve(process.cwd(), 'src/styles/agent-conversation.css'), 'utf8')

function ruleBody(selector: string) {
  const start = css.indexOf(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return open < 0 || close < 0 ? '' : css.slice(open + 1, close)
}

// 用户反馈"尺寸和原来的不对"：待决策标记必须和运行中那个 loader **一样大**。
describe('needs-decision mark size', () => {
  it('keeps the original loader grid untouched at 4px cells and 1.5px gap', () => {
    const grid = ruleBody('.agent-pixel {')
    expect(grid).toContain('grid-template-columns: repeat(3, 4px)')
    expect(grid).toContain('gap: 1.5px')
    const cell = ruleBody('.agent-pixel__cell {')
    expect(cell).toContain('width: 4px')
    expect(cell).toContain('height: 4px')
  })

  // 尺寸一致靠"复用同一套网格与格子类"，而不是靠两处各写一份 4px（那样迟早漂移）。
  it('reuses the very same grid classes as the loader', () => {
    const { container } = render(<AgentDecisionMark />)
    expect(container.querySelectorAll('.agent-pixel')).toHaveLength(1)
    const cells = container.querySelectorAll('.agent-pixel__cell')
    expect(cells).toHaveLength(8)
    // 中心占位也走同一套 4px 尺寸（否则网格会被挤窄）。
    const hole = ruleBody('.agent-pixel__cell--hole {')
    expect(hole).toContain('width: 4px')
    expect(hole).toContain('height: 4px')
  })

  it('does not carry the old, smaller grid of its own any more', () => {
    const { container } = render(<AgentDecisionMark />)
    expect(container.querySelector('.agent-decision-grid')).toBeNull()
    expect(container.querySelectorAll('.agent-decision-grid__cell')).toHaveLength(0)
    // 也不许自己写死 14px 的容器去挤网格。
    expect(container.querySelector('.size-3\\.5')).toBeNull()
    expect(css).not.toContain('.agent-decision-grid__cell')
  })
})

describe('needs-decision mark appearance', () => {
  it('draws eight amber cells with an empty centre', () => {
    const { container } = render(<AgentDecisionMark />)
    const cells = container.querySelectorAll('.agent-pixel__cell')
    expect(cells).toHaveLength(8)
    for (const cell of cells) expect(cell.className).toMatch(/bg-amber-500\b/)
    const slots = container.querySelectorAll('.agent-pixel > *')
    expect(slots).toHaveLength(9)
    expect(slots[4]?.className).toContain('agent-pixel__cell--hole')
    expect(slots[4]?.className).not.toContain('agent-pixel__cell ')
  })

  // 待决策要"停下来等你"，不是运行中那种 650ms 快跳。
  it('stops the running animation and breathes gently instead', () => {
    const decision = ruleBody('.agent-pixel--decision .agent-pixel__cell {')
    expect(decision).toContain('animation: none')
    expect(ruleBody('.agent-pixel--decision {')).toContain('agent-decision-breathe 2.4s')
    // 原版 loader 的动画定义保持不变（它仍然在转）。
    expect(ruleBody('.agent-pixel__cell {')).toContain('agent-pixel-on 650ms')
  })

  it('announces itself as a status with a bilingual label', () => {
    render(<AgentDecisionMark />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('需要你决定')
    render(<AgentDecisionMark label="Needs your decision" />)
    expect(screen.getAllByRole('status')[1]?.getAttribute('aria-label')).toBe('Needs your decision')
  })
})
