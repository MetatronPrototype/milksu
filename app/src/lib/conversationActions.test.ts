import { describe, expect, it } from 'vitest'
import {
  assistantForkPoint,
  cloneConversationForFork,
  conversationCopyText,
} from '@/lib/conversationActions'
import type { Conversation, Message } from '@/types'

function message(role: Message['role'], id: string): Message {
  return { id, role, content: id, timestamp: 1 }
}

const source: Conversation = {
  id: 'source-1',
  title: 'Fix login',
  createdAt: 10,
  pinned: true,
  pinnedOrder: 2,
  archivedAt: 99,
  workspacePath: '/workspace/app',
  workspaceHome: 'chat',
  kernel: 'pi',
  modelId: 'deepseek-flash',
  lastContextUsage: {
    inputTokens: 12,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 15,
    recordedAt: 1,
  },
  messages: [message('user', 'u1'), message('assistant', 'a1')],
}

describe('conversation sidebar actions', () => {
  it('copies only the title and conversation id', () => {
    expect(conversationCopyText(source)).toBe('Fix login\nsource-1')
    expect(conversationCopyText({ id: '', title: '  ' })).toBe('')
    expect(conversationCopyText({ id: 'abc', title: '' })).toBe('abc')
  })

  it('finds the last assistant fork point', () => {
    expect(assistantForkPoint([])).toBeNull()
    expect(assistantForkPoint([message('user', 'u1')])).toBeNull()
    expect(assistantForkPoint([
      message('user', 'u1'),
      message('assistant', 'a1'),
      message('user', 'u2'),
      message('assistant', 'a2'),
    ])).toEqual({ index: 3, occurrence: 1 })
  })

  it('clones the product row without pin, archive, or usage leftovers', () => {
    const forked = cloneConversationForFork(source, {
      id: 'fork-1',
      title: 'Fix login',
      messages: source.messages,
    })
    expect(forked.id).toBe('fork-1')
    expect(forked.workspacePath).toBe('/workspace/app')
    expect(forked.workspaceHome).toBe('chat')
    expect(forked.kernel).toBe('pi')
    expect(forked.modelId).toBe('deepseek-flash')
    expect(forked.pinned).toBeUndefined()
    expect(forked.pinnedOrder).toBeUndefined()
    expect(forked.archivedAt).toBeUndefined()
    expect(forked.lastContextUsage).toBeUndefined()
    expect(forked.messages).toEqual(source.messages)
    expect(forked.messages[0]).not.toBe(source.messages[0])
  })
})
