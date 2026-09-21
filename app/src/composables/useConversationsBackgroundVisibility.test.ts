// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { payload: unknown }) => void
const handlers = new Map<string, Handler>()

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'list_conversations') return []
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

const TASK_NAME = '打包探针'

function emitEngineEvent(payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload })
}

async function loadRuntime() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  // 真实驱动：rewindContext() 在 `runningIds.has(id)` 时调 finishRun（:3339）⇒ 这就是回合结束的汇合点。
  conversations.store.setState({
    conversations: [{
      id: 'conversation-1',
      title: '探针',
      kernel: 'pi',
      messages: [{ id: 'm1', role: 'user', content: '开始打包', timestamp: 1, status: 'done' }],
    }],
  } as never)
  return conversations
}

describe('background task survives the turn end', () => {
  beforeEach(async () => {
    handlers.clear()
    const { applyUiLocale } = await import('@/lib/uiLocale')
    applyUiLocale('zh')
  })

  it('reaches the real turn-end path and then says the task is still running', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    // 真实事件：bg_task 起了一个后台任务。
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
    ] })
    // 事实层留下了它（(C)① 要靠它做状态区那一行）。
    expect(conversations.store.getState().backgroundTasks['conversation-1']).toHaveLength(1)
    conversations.store.setState({ engineNotice: '' })

    // —— 第 1 步：先证明**驱动真的到达了 finishRun**（runningIds 真的收缩）——
    // settleRunsForRuntimeRecovery 就是 reap 扫描（:3325，遍历所有 runningIds 逐个 finishRun），且是导出的。
    conversations.settleRunsForRuntimeRecovery()
    expect(conversations.store.getState().runningIds.has('conversation-1')).toBe(false)

    // —— 第 2 步：再断言提示 ——
    const notice = conversations.store.getState().engineNotice
    expect(notice).toContain('后台仍在运行')
    expect(notice).toContain(TASK_NAME)
    expect(notice).toContain('请不要关机')
  })

  it('says the same in English, with the count', async () => {
    const { applyUiLocale } = await import('@/lib/uiLocale')
    const conversations = await loadRuntime()
    applyUiLocale('en')
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
      { id: 't2', name: 'verify', kind: 'process', status: 'running', startedAt: 1 },
    ] })
    conversations.store.setState({ engineNotice: '' })
    conversations.settleRunsForRuntimeRecovery()
    expect(conversations.store.getState().runningIds.has('conversation-1')).toBe(false)
    const notice = conversations.store.getState().engineNotice
    expect(notice).toContain('Still running in the background')
    expect(notice).toContain('2 ·')
  })

  // 跨层名字：侧车发 `background_tasks`，但引擎在 `internal/engine/supervisor.go` 的改名表里
  // 把它改写成 `runtime.background_tasks` 再交给渲染层（subagent_tasks/dsh_jobs/compaction_*
  // 都是同一张表）。只认侧车名字 ⇒ 真机上**静默收不到** ⇒ 状态区那行与回合结束提示一起消失。
  it('hears the event under the name the engine actually forwards', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'runtime.background_tasks', tasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
    ] })
    expect(conversations.store.getState().backgroundTasks['conversation-1']).toHaveLength(1)
    conversations.store.setState({ engineNotice: '' })
    conversations.settleRunsForRuntimeRecovery()
    expect(conversations.store.getState().runningIds.has('conversation-1')).toBe(false)
    const notice = conversations.store.getState().engineNotice
    expect(notice).toContain('后台仍在运行')
    expect(notice).toContain(TASK_NAME)
  })
})
