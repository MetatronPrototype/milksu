// @vitest-environment jsdom

// 搬运自本地分支的存活/卡住指示（B）：把"有进展"和"引擎还在"分开验证。
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

function storedConversation(id: string) {
  return { id, title: id, createdAt: 1, messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

async function boot() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  stored = [storedConversation('conversation-1')]
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return conversations
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
    const conversations = await boot()
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.streamStale).toBe(false)

    // 20 秒没有任何事件：流已经"安静"到超阈值，但还在跑的回合仍然算在跑。
    vi.advanceTimersByTime(20_000)
    expect(conversations.streamStale).toBe(true)
    expect(conversations.streamStaleSeconds).toBeGreaterThanOrEqual(18)
    // 心跳只在 5 秒一次时才会来；这里一个都没有，所以引擎不算"活着"。
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
    const conversations = await boot()
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeToolRunning).toBe(false)

    emit('conversation-1', { type: 'tool.started', toolCallId: 'call-1', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(true)
    // 另一个对话的工具不能影响当前对话。
    emit('conversation-2', { type: 'tool.started', toolCallId: 'call-2', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(true)

    emit('conversation-1', { type: 'tool.progress', toolCallId: 'call-1', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(true)

    emit('conversation-1', { type: 'tool.completed', toolCallId: 'call-1', toolName: 'bash' })
    expect(conversations.activeToolRunning).toBe(false)
  })

  it('never reports a running tool as stalled, and only the long silence becomes a stuck turn', async () => {
    const conversations = await boot()
    emit('conversation-1', { type: 'assistant.started' })
    emit('conversation-1', { type: 'tool.started', toolCallId: 'call-1', toolName: 'bash' })

    vi.advanceTimersByTime(60_000)
    // 工具在跑：即使安静很久，也只能说"工具执行中"，不能说引擎没响应。
    expect(conversations.streamStale).toBe(true)
    expect(conversations.activeToolRunning).toBe(true)
    expect(conversations.streamStaleSeconds).toBeGreaterThanOrEqual(45)
  })
})
