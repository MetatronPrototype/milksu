// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundTaskStrip } from '@/components/BackgroundTaskStrip'

const task = (name: string, status = 'running') => ({ id: `t-${name}`, name, status })

async function setLocale(value: 'zh' | 'en') {
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale(value)
}

describe('background task strip', () => {
  beforeEach(async () => {
    await setLocale('zh')
    vi.useRealTimers()
  })

  // 这个仓库没有开 testing-library 的自动清理 ⇒ 显式清，避免多次 render 命中多个窄带。
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  // 有在跑 ⇒ 四行：标题 / 件数·名字 / 状态 / 请不要关机。
  it('shows the four lines while tasks are running', () => {
    render(<BackgroundTaskStrip running={[task('打包'), task('verify')]} outcome={null} />)
    const strip = screen.getByTestId('background-task-strip')
    expect(strip).not.toBeNull()
    expect(strip.textContent).toContain('后台任务进行中')
    expect(strip.textContent).toContain('2 件 · 打包（还有 1 件）')
    expect(strip.textContent).toContain('进行中')
    expect(strip.textContent).toContain('请不要关机')
    expect(strip.getAttribute('data-mode')).toBe('running')
  })

  // M=0（只有一件）⇒ **不写**「（还有 …）」。
  it('omits the "more" part when only one task is running', () => {
    render(<BackgroundTaskStrip running={[task('打包')]} outcome={null} />)
    const text = screen.getByTestId('background-task-strip').textContent ?? ''
    expect(text).toContain('1 件 · 打包')
    expect(text).not.toContain('还有')
  })

  // 英文界面成对（仓库硬约定）。
  it('is bilingual', async () => {
    await setLocale('en')
    render(<BackgroundTaskStrip running={[task('打包')]} outcome={null} />)
    const text = screen.getByTestId('background-task-strip').textContent ?? ''
    expect(text).toContain('Background task running')
    expect(text).toContain('Please do not shut down')
    expect(text).toContain('Running')
  })

  // 终态：显示状态那行、不显示"请不要关机"，并在 10 秒后自动收起（假定时器）。
  it('shows a settled outcome and hides it after ten seconds', () => {
    vi.useFakeTimers()
    render(<BackgroundTaskStrip running={[]} outcome={{ kind: 'completed', count: 1, firstName: '打包', at: Date.now() }} />)
    const strip = screen.getByTestId('background-task-strip')
    expect(strip.getAttribute('data-mode')).toBe('settled')
    expect(strip.textContent).toContain('已完成')
    expect(strip.textContent).toContain('1 件 · 打包')
    expect(strip.textContent).not.toContain('请不要关机')
    act(() => { vi.advanceTimersByTime(10_000 + 100) })
    expect(screen.queryByTestId('background-task-strip')).toBeNull()
  })

  // 终态显示期间又开始新任务 ⇒ 立刻切回"进行中"，旧定时器清掉（不会把新任务一并收起）。
  it('switches back to running when a new task starts during a settled window', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <BackgroundTaskStrip running={[]} outcome={{ kind: 'failed', count: 1, firstName: '打包', at: Date.now() }} />,
    )
    expect(screen.getByTestId('background-task-strip').textContent).toContain('失败')
    rerender(<BackgroundTaskStrip running={[task('新打包')]} outcome={{ kind: 'failed', count: 1, firstName: '打包', at: Date.now() }} />)
    const strip = screen.getByTestId('background-task-strip')
    expect(strip.getAttribute('data-mode')).toBe('running')
    expect(strip.textContent).toContain('新打包')
    act(() => { vi.advanceTimersByTime(10_000 + 100) })
    // 新任务还在跑 ⇒ 不许被旧定时器收起。
    expect(screen.getByTestId('background-task-strip')).not.toBeNull()
  })

  // 没有在跑也没有终态 ⇒ 整条不出现。
  it('renders nothing without a task or an outcome', () => {
    render(<BackgroundTaskStrip running={[]} outcome={null} />)
    expect(screen.queryByTestId('background-task-strip')).toBeNull()
  })
})
