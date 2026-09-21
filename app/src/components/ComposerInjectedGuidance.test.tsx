// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ComposerInjectedGuidance from '@/components/ComposerInjectedGuidance'

afterEach(cleanup)

// ① 工具在跑 ⇒ 等待中，且**不许**出现"已加入"（用户说的误导就是这里）。
it('shows the waiting sentence while a tool is running', () => {
  const { container } = render(<ComposerInjectedGuidance messages={['停止']} toolRunning />)
  const text = container.textContent ?? ''
  expect(text).toContain('正在等待工具调用结束，结束后加入对话')
  expect(text).toContain('1 条引导等待加入')
  expect(text).not.toContain('已加入本轮')
  // 等待中不用打勾（用灰色小圆点区分）。
  expect(container.querySelector('svg')).toBeNull()
})

// ② 工具结束 ⇒ 才显示"已加入本轮"（并保留打勾）。
it('switches to the joined sentence once no tool is running', () => {
  const { container } = render(<ComposerInjectedGuidance messages={['停止']} toolRunning={false} />)
  const text = container.textContent ?? ''
  expect(text).toContain('已加入本轮')
  expect(text).toContain('1 条引导已加入本轮')
  expect(text).not.toContain('正在等待工具调用结束')
  expect(container.querySelector('svg')).not.toBeNull()
})

// ③ 回归保护：没有注入项 ⇒ 整块不渲染（不许出现空标题）。
it('renders nothing at all when there is no injected guidance', () => {
  const { container } = render(<ComposerInjectedGuidance messages={[]} toolRunning />)
  expect(container.innerHTML).toBe('')
  expect(screen.queryByLabelText(/引导/)).toBeNull()
  const { container: missing } = render(<ComposerInjectedGuidance toolRunning />)
  expect(missing.innerHTML).toBe('')
})
