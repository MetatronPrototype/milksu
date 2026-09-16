// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from '@/lib/reactStore'
import { createConversationsRuntime } from '@/composables/useConversations'

const desktop = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  listenEvent: vi.fn(async () => () => undefined),
}))

vi.mock('@/desktop', () => ({
  invokeCommand: (...args: unknown[]) => desktop.invokeCommand(
    ...args as [string, unknown?]
  ),
  listenEvent: (...args: unknown[]) => desktop.listenEvent(
    ...args as [string, (event: unknown) => void]
  ),
}))

const mountedRuntimes: Array<{ dispose: () => void }> = []

function mountConversations() {
  const runtime = createConversationsRuntime()
  mountedRuntimes.push(runtime)
  return runtime
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  desktop.invokeCommand.mockReset()
  desktop.invokeCommand.mockImplementation(async (command: string) => {
    if (command === 'save_conversation') return null
    return null
  })
  desktop.listenEvent.mockClear()
})

afterEach(() => {
  for (const runtime of mountedRuntimes.splice(0)) runtime.dispose()
})

describe('update restart conversation persist', () => {
  it('flushes the running conversation immediately instead of waiting for the debounce', async () => {
    const conversations = mountConversations()
    conversations.conversations = [{
      id: 'conversation-1',
      title: 'Running',
      createdAt: 1,
      messages: [{
        id: 'user-1',
        role: 'user',
        content: 'keep going',
        timestamp: 1,
      }, {
        id: 'assistant-1',
        role: 'assistant',
        content: 'halfway',
        timestamp: 2,
        status: 'running',
      }],
    }]
    conversations.activeId = 'conversation-1'
    conversations.store.setState(state => ({
      ...state,
      runningIds: new Set(['conversation-1']),
    }))

    desktop.invokeCommand.mockClear()
    await conversations.flushPendingSaves()

    const saved = desktop.invokeCommand.mock.calls.filter(([command]) => command === 'save_conversation')
    expect(saved).toHaveLength(1)
    expect(saved[0]?.[1]).toMatchObject({
      conversation: { id: 'conversation-1' },
    })
  })

  it('settles the interrupted turn before the update quits so the next launch can continue', async () => {
    const conversations = mountConversations()
    conversations.conversations = [{
      id: 'conversation-1',
      title: 'Running',
      createdAt: 1,
      messages: [{
        id: 'user-1',
        role: 'user',
        content: 'keep going',
        timestamp: 1,
      }, {
        id: 'tool-1',
        role: 'tool',
        content: 'writing',
        timestamp: 2,
        toolName: 'write',
        status: 'running',
      }],
    }]
    conversations.activeId = 'conversation-1'
    conversations.store.setState(state => ({
      ...state,
      runningIds: new Set(['conversation-1']),
    }))

    await conversations.prepareConversationsForUpdateRestart()
    await settle()

    const conversation = conversations.conversations.find(item => item.id === 'conversation-1')
    expect(conversations.runningConversationIds).toEqual([])
    expect(conversation?.messages.some(message => message.status === 'running')).toBe(false)
    expect(conversation?.messages.at(-1)?.content).toBe('本轮已停止。')
  })
})
