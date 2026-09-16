import { describe, expect, it } from 'vitest'
import type { Conversation, SubagentTask } from '@/types'
import {
  childConversationsFor,
  isMultitaskChildConversation,
  liveWorkingItems,
  workingItemsForConversation,
  workingRootConversation,
} from './workingRoster'

function conversation(partial: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation {
  return {
    title: partial.title ?? partial.id,
    createdAt: 1,
    messages: partial.messages ?? [],
    ...partial,
  }
}

describe('working roster', () => {
  it('walks a child session back to its parent', () => {
    const parent = conversation({ id: 'parent', kernel: 'dsh' })
    const child = conversation({ id: 'child', parentConversationId: 'parent', kernel: 'dsh' })
    expect(isMultitaskChildConversation(child)).toBe(true)
    expect(workingRootConversation(child, [parent, child])?.id).toBe('parent')
    expect(childConversationsFor('parent', [parent, child]).map(item => item.id)).toEqual(['child'])
  })

  it('projects Pi roster rows and DSH child sessions into one Working list', () => {
    const tasks: SubagentTask[] = [
      { id: 'call-1', role: 'scout', status: 'running' },
      { id: 'call-2', role: 'writer', status: 'succeeded' },
    ]
    const parent = conversation({
      id: 'parent',
      kernel: 'pi',
      subagentTasks: tasks,
    })
    const items = workingItemsForConversation(parent, [parent], [])
    expect(items.map(item => item.id)).toEqual(['call-1', 'call-2'])
    expect(items[0]).toMatchObject({ kind: 'subagent', stoppable: false, status: 'running' })
    expect(liveWorkingItems(items).map(item => item.id)).toEqual(['call-1'])
  })

  it('attaches a DSH child session onto the matching native task instead of duplicating it', () => {
    const parent = conversation({
      id: 'parent',
      kernel: 'dsh',
      subagentTasks: [{ id: 'cf4fb9a2', role: '环境巡检', status: 'running', toolCallId: 'call-1' }],
    })
    const child = conversation({
      id: 'cf4fb9a2',
      parentConversationId: 'parent',
      kernel: 'dsh',
      title: '环境巡检',
    })
    const items = workingItemsForConversation(parent, [parent, child], ['cf4fb9a2'])
    expect(items).toEqual([expect.objectContaining({
      id: 'cf4fb9a2',
      kind: 'subagent',
      conversationId: 'cf4fb9a2',
      stoppable: true,
      status: 'running',
    })])
  })

  it('marks DSH children stoppable and live while the child turn is running', () => {
    const parent = conversation({ id: 'parent', kernel: 'dsh', multitask: true })
    const child = conversation({
      id: 'child',
      parentConversationId: 'parent',
      kernel: 'dsh',
      title: 'Review auth',
      messages: [{ id: 'u1', role: 'user', content: 'Review auth', timestamp: 1 }],
    })
    const items = workingItemsForConversation(parent, [parent, child], ['child'])
    expect(items).toEqual([expect.objectContaining({
      id: 'child',
      kind: 'child',
      title: 'Review auth',
      status: 'running',
      stoppable: true,
      conversationId: 'child',
    })])
  })
})
