// @vitest-environment jsdom

// 搬运自本地分支的三级停止（A）：软停无确认 → 重试 → 本地强制停止，且迟到事件不许复活回合。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []
const commands: string[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  commands.push(command)
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

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations three-tier stop', () => {
  beforeEach(() => {
    handlers.clear()
    commands.length = 0
    invokeCommand.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('escalates a stop the engine never acknowledges up to a local force stop', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [{ id: 'conversation-1', title: 'conversation-1', createdAt: 1, messages: [] }]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning).toBe(true)

    // 第 1 级：软停提交后等确认。
    await conversations.abort('conversation-1')
    expect(conversations.activeAborting).toBe(true)
    expect(conversations.activeAbortStalled).toBe(false)

    // 10 秒没有终态事件 → 第一次无确认：给“重试停止”，还不能强制。
    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAbortStalled).toBe(true)
    expect(conversations.activeForceStopReady).toBe(false)

    // 第 2 级：重试一次，再等 10 秒仍无确认 → 升级为可本地强制停止。
    await conversations.abort('conversation-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeForceStopReady).toBe(true)

    // 第 3 级：本地结算 + 请后端硬停。
    await conversations.forceStopConversation('conversation-1')
    expect(conversations.activeRunning).toBe(false)
    expect(commands).toContain('stop_coding_session')
    const settled = conversations.conversations.find(item => item.id === 'conversation-1')
    expect(
      (settled?.messages ?? []).some(message => String(message.content ?? '').includes('本轮已强制停止')),
    ).toBe(true)

    // 迟到的引擎事件不许把回合复活。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning).toBe(false)
  })
})
