// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import AgentBackgroundTaskMark from '@/components/AgentBackgroundTaskMark'

// 用户给出的形态：**同一套九格**（尺寸与运行中/待决标一致），只点亮一条路径 ——
// 左下 → 中下 → 中 → 中上 → 右上（行优先索引 6 → 7 → 4 → 1 → 2），颜色**蓝色**。
describe('AgentBackgroundTaskMark', () => {
  it('keeps nine slots and lights exactly the five on the path', () => {
    const { container } = render(<AgentBackgroundTaskMark />)
    const slots = Array.from(container.querySelectorAll('.agent-pixel > span'))
    const lit = slots
      .map((slot, index) => (slot.classList.contains('agent-pixel__cell') ? index : -1))
      .filter(index => index >= 0)
    expect(slots).toHaveLength(9)
    expect(lit).toEqual([1, 2, 4, 6, 7])
  })

  it('is blue on the lit cells only, and announces itself as a status', () => {
    const { container } = render(<AgentBackgroundTaskMark />)
    // 蓝色只跟着点亮的格子走：容器着色会让未点亮的格子（透明）也泛蓝 ✗（真机截图证实）。
    expect(container.querySelector('.agent-pixel--bg-task')?.classList.contains('bg-blue-400')).toBe(false)
    expect(container.querySelectorAll('.agent-pixel__cell--bg-task.bg-blue-400')).toHaveLength(5)
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBeTruthy()
    expect(container.querySelector('button')).toBeNull()
  })
})
