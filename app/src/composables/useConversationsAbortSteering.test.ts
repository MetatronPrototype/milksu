// @vitest-environment jsdom

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

describe('useConversations abort confirmation', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // AbortMessage only submits the interrupt. If Pi never answers with a terminal
  // event the stop button stayed disabled forever; it must become retryable.
  it('releases the stop button when the engine never confirms the abort', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning.value).toBe(true)

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting.value).toBe(true)
    expect(conversations.activeAbortStalled.value).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAborting.value).toBe(false)
    expect(conversations.activeAbortStalled.value).toBe(true)

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting.value).toBe(true)
    expect(conversations.activeAbortStalled.value).toBe(false)
  })

  it('clears the stalled stop state once the turn actually settles', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.abort('conversation-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAbortStalled.value).toBe(true)

    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning.value).toBe(false)
    expect(conversations.activeAbortStalled.value).toBe(false)
  })
})

describe('useConversations steering delivery', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // A steering message must never disappear silently. When the turn settles
  // before Pi consumed it, it stays visible as an undelivered queue entry.
  it('keeps unconsumed steering visible when the turn settles', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.send('先保留修改')

    expect(conversations.activeMessageQueue.value.steering).toEqual(['先保留修改'])
    expect(conversations.activeMessageQueue.value.stalled).toBeUndefined()

    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeMessageQueue.value.steering).toEqual(['先保留修改'])
    expect(conversations.activeMessageQueue.value.stalled).toBe(true)
  })

  it('drops the undelivered marker once Pi reports an empty queue', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.send('先保留修改')
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeMessageQueue.value.stalled).toBe(true)

    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: [] })
    expect(conversations.activeMessageQueue.value.steering).toEqual([])
    expect(conversations.activeMessageQueue.value.stalled).toBeFalsy()
  })
})

describe('useConversations engine stop scoping', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // A session-less engine.stopped used to clear every running conversation.
  // A turn on another engine instance must keep its running state.
  it('keeps a concurrent turn on another engine running', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-pi', title: 'pi', createdAt: 1, kernel: 'pi', messages: [] },
      { id: 'conversation-dsh', title: 'dsh', createdAt: 2, kernel: 'dsh', messages: [] },
    ]
    await conversations.load()
    await conversations.listen()
    emit('conversation-pi', { type: 'assistant.started' })
    emit('conversation-dsh', { type: 'assistant.started' })
    expect([...conversations.runningConversationIds.value].sort())
      .toEqual(['conversation-dsh', 'conversation-pi'])

    emit('', { type: 'engine.stopped', engine: 'pi', error: 'sidecar exited' })
    expect(conversations.runningConversationIds.value).toEqual(['conversation-dsh'])
  })

  it('clears every session served by the stopped engine', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-pi-a', title: 'a', createdAt: 1, kernel: 'pi', messages: [] },
      { id: 'conversation-pi-b', title: 'b', createdAt: 2, kernel: 'pi', messages: [] },
    ]
    await conversations.load()
    await conversations.listen()
    emit('conversation-pi-a', { type: 'assistant.started' })
    emit('conversation-pi-b', { type: 'assistant.started' })
    expect(conversations.runningConversationIds.value).toHaveLength(2)

    emit('', { type: 'engine.protocol_error', engine: 'pi', error: 'stream closed' })
    expect(conversations.runningConversationIds.value).toEqual([])
  })
})
