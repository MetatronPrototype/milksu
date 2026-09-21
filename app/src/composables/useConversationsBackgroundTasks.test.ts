// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { payload: unknown }) => void
const handlers = new Map<string, Handler>()
const commandCalls: string[] = []

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string) => {
    commandCalls.push(command)
    // 与其它夹具一致：`load()` 需要 list_conversations 给数组 ✓（返回 null 会让它当场崩 ✗）。
    // 真实环境里列表是非空的 ✓ —— 后台任务的一次性拉取要拿它取会话 id 与工作区。
    if (command === 'list_conversations') {
      return [{ id: 'conversation-1', title: '探针', createdAt: 1, workspacePath: '/tmp/ws' }]
    }
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

// 用**真实的事件形状**喂：`event.payload = { sessionId, type, tasks }`（引擎事件就是这一层 ✓）。
function emitEngineEvent(payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload })
}

function runningTask(name: string) {
  return { id: `task-${name}`, name, kind: 'process', status: 'running', startedAt: 1_000 }
}

async function loadRuntime() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return conversations
}

describe('background task visibility', () => {
  beforeEach(() => {
    handlers.clear()
    commandCalls.length = 0
  })

  // (a) 回合已结束 + 仍有后台任务 ⇒ 必须**说清在跑什么**、并提醒别关机。
  it('names the task that is still running once the turn has ended', async () => {
    const conversations = await loadRuntime()
    // 回合没在跑（= 界面显示已结束）⇒ 这时最需要提示。
    conversations.store.setState({ runningIds: new Set() })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [runningTask('打包')] })
    const notice = conversations.store.getState().engineNotice ?? ''
    expect(notice).toContain('后台仍在运行：打包')
    expect(notice).toContain('请不要关机')
  })

  // (b) 任务清空 ⇒ 说一声"已完成"（否则读者一直以为还在跑）。
  it('says the background work finished once nothing is running', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set() })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [runningTask('打包')] })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [] })
    expect(conversations.store.getState().engineNotice ?? '').toContain('后台任务已完成')
  })

  // (c) 没有后台任务 ⇒ 不许无中生有（既不出现"仍在运行"，也不出现"已完成"）。
  it('says nothing at all when there is no background task', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set(), engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [] })
    const notice = conversations.store.getState().engineNotice ?? ''
    expect(notice).not.toContain('后台仍在运行')
    expect(notice).not.toContain('后台任务已完成')
  })

  // (d) 加载时**主动拉一次**（重启后已有任务在跑时，事件还没来 ⇒ 否则漏报）。
  it('asks for the current background tasks once when loading, and never polls', async () => {
    await loadRuntime()
    const refreshes = commandCalls.filter(command => command === 'refresh_coding_background_tasks')
    expect(refreshes).toHaveLength(1)
  })
})
