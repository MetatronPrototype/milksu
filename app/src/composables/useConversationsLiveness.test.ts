// @vitest-environment jsdom

// 搬运自本地分支的存活/卡住/排队指示（B + E）：把"有进展"、"引擎还在"和"在排队"分开验证。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return stored
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function storedConversation(id: string, workspacePath = '') {
  return { id, title: id, createdAt: 1, workspacePath, messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations liveness', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a heartbeat keeps saying the engine is alive without counting as progress', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.streamStale).toBe(false)

    // 20 秒没有任何事件：流已经"安静"到超阈值，但还在跑的回合仍然算在跑。
    vi.advanceTimersByTime(20_000)
    expect(conversations.streamStale).toBe(true)
    expect(conversations.streamStaleSeconds).toBeGreaterThanOrEqual(18)
    // 心跳是 5 秒一次才会来；这里一个都没有，所以引擎不算"活着"。
    expect(conversations.activeEngineAlive).toBe(false)

    // 心跳只能说"引擎还在"，不能说"有进展"：停滞时钟不许被它清零。
    emit('conversation-1', { type: 'turn.heartbeat' })
    expect(conversations.activeEngineAlive).toBe(true)
    expect(conversations.streamStale).toBe(true)
    expect(conversations.streamStaleSeconds).toBeGreaterThanOrEqual(18)

    // 真正的事件才算进展。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.streamStale).toBe(false)
    expect(conversations.streamStaleSeconds).toBe(0)
  })

  it('tracks running tools per conversation so a tool is never read as a dead stream', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1'), storedConversation('conversation-2')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeToolRunning).toBe(false)

    emit('conversation-1', { type: 'tool.started', toolCallId: 'call-1', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(true)
    // 另一个对话的工具不影响当前对话。
    emit('conversation-2', { type: 'tool.started', toolCallId: 'call-2', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(true)

    emit('conversation-1', { type: 'tool.progress', toolCallId: 'call-1', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(true)

    emit('conversation-1', { type: 'tool.completed', toolCallId: 'call-1', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(false)
  })

  it('never reports a running tool as stalled, and only a long silence becomes a stuck turn', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    emit('conversation-1', { type: 'tool.started', toolCallId: 'call-1', toolName: 'bash' })

    vi.advanceTimersByTime(60_000)
    // 工具在跑：即使安静很久，也只能说"工具执行中"，不能说引擎没响应。
    expect(conversations.streamStale).toBe(true)
    expect(conversations.activeToolRunning).toBe(true)
    expect(conversations.streamStaleSeconds).toBeGreaterThanOrEqual(45)
  })

  // E 队列可见性：两个对话共用同一个 sidecar 时，后到的那个是在排队，不是连接丢了。
  it('names the sibling that holds the shared sidecar instead of calling it stalled', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { ...storedConversation('holder', '/workspace/a'), title: '正在跑的会话' },
      storedConversation('waiting', '/workspace/a'),
    ]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'waiting'

    // 兄弟对话已经在产生事件 → 它确实占着这个 sidecar。
    // runStartedAt 是派发时刻，所以“事件晚于它”才证明引擎真的在答这个回合。
    emit('holder', { type: 'assistant.started' })
    vi.advanceTimersByTime(1000)
    emit('holder', { type: 'assistant.started' })
    // 当前对话已派发但还没有事件 → 正在排队。
    emit('waiting', { type: 'assistant.started' })
    expect(conversations.activeQueuedBehind).toBe('正在跑的会话')

    // 自己的回合开始产生事件后，就不再算排队。
    vi.advanceTimersByTime(1000)
    emit('waiting', { type: 'assistant.started' })
    expect(conversations.activeQueuedBehind).toBe('')
  })
})
