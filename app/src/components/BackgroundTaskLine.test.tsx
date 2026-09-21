// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackgroundTaskLine } from '@/components/BackgroundTaskLine'

async function setLocale(value: 'zh' | 'en') {
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale(value)
}

describe('background task line', () => {
  beforeEach(async () => {
    await setLocale('zh')
  })

  // ① 有任务在跑 ⇒ 状态区有这一行（说清件数 + 在跑什么），双语。
  it('shows how many background tasks are still running, and which', async () => {
    const { container } = render(<BackgroundTaskLine tasks={[{ id: 't1', name: '打包', status: 'running' }]} />)
    expect(container.textContent).toContain('后台仍在运行')
    expect(container.textContent).toContain('打包')
    expect(container.textContent).toContain('1 件')

    await setLocale('en')
    const english = render(<BackgroundTaskLine tasks={[{ id: 't1', name: '打包', status: 'running' }]} />)
    expect(english.container.textContent).toContain('Still running in the background')
    expect(english.container.textContent).toContain('1 ·')
  })

  it('carries the count when several are running', () => {
    const { container } = render(<BackgroundTaskLine tasks={[
      { id: 't1', name: '打包', status: 'running' },
      { id: 't2', name: 'verify', status: 'running' },
    ]} />)
    expect(container.textContent).toContain('2 件')
  })

  // ② 任务清零 ⇒ 这一行消失（(C)① 的"粘住"以事实为准：事实空 ⇒ 行消失）。
  it('disappears once nothing is running any more', () => {
    const { container } = render(<BackgroundTaskLine tasks={[]} />)
    expect(container.innerHTML).toBe('')
  })

  // ③ 回归保护：从来没有任务 ⇒ 不出现这一行（也不留空壳）。
  it('renders nothing at all when there never was a background task', () => {
    const { container } = render(<BackgroundTaskLine />)
    expect(container.innerHTML).toBe('')
  })
})
