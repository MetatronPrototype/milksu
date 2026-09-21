// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundTaskLine } from '@/components/BackgroundTaskLine'

const handlers = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'list_conversations') return []
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

async function setLocale(value: 'zh' | 'en') {
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale(value)
}

describe('background task line', () => {
  beforeEach(async () => {
    handlers.clear()
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

  // ② 任务清零 ⇒ 这一行消失（(C)① 的"粘住"以事实为准）。
  it('disappears once nothing is running any more', () => {
    const { container } = render(<BackgroundTaskLine tasks={[]} />)
    expect(container.innerHTML).toBe('')
  })

  // ③ 回归保护：从来没有任务 ⇒ 不出现这一行（也不留空壳）。
  it('renders nothing at all when there never was a background task', () => {
    const { container } = render(<BackgroundTaskLine />)
    expect(container.innerHTML).toBe('')
  })

  // —— 端到端：跨过"事件 ⇒ store ⇒ 那一行"这道坎 ——
  // 真机没生效的真因：侧栏调了 useConversations() **工厂**（每次新建 store）⇒ 事实写进 A、界面读 B。
  it('fills the store from the real event and renders the line for that same runtime', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.listen()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'background_tasks',
      tasks: [{ id: 't1', name: '验收用后台任务', kind: 'process', status: 'running', startedAt: 1 }],
    } })
    const tasks = conversations.backgroundTasks['conversation-1']
    expect(tasks).toHaveLength(1)
    const { container } = render(<BackgroundTaskLine tasks={tasks} />)
    expect(container.textContent).toContain('后台仍在运行')
    expect(container.textContent).toContain('验收用后台任务')
  })

  it('routes the fact through props, never through a second store', () => {
    const sidebar = readFileSync('src/components/ContextSidebar.tsx', 'utf8')
    // 只查**导入**：这个文件里别处（预览等）仍有对工厂的调用，与后台任务这一行无关。
    expect(sidebar).not.toContain("@/composables/useConversations")
    expect(sidebar).toContain('backgroundTasks?:')
    expect(sidebar).toContain('backgroundTasks?.[conversation.id]')
    const appSidebar = readFileSync('src/components/AppSidebar.tsx', 'utf8')
    expect(appSidebar).toContain('backgroundTasks={backgroundTasks}')
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('backgroundTasks={conversations.backgroundTasks}')
  })
})
