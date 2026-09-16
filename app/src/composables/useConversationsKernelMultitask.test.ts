// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeCommand = vi.fn(async (command: string) => {
  if (command === 'list_conversations') return []
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  if (command === 'save_conversation') return null
  if (command === 'send_message') return null
  if (command === 'ensure_coding_artifact_workspace') return ''
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async () => () => undefined),
}))

describe('default kernel and DSH multitask children', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('applies the settings default kernel only to new conversations', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const id = conversations.ensureConversation('task')
    expect(conversations.conversations.find(item => item.id === id)?.kernel).toBe('dsh')

    conversations.setKernel('pi')
    conversations.setDefaultKernel('dsh')
    expect(conversations.conversations.find(item => item.id === id)?.kernel).toBe('pi')
    conversations.dispose()
  })

  it('spawns a DSH child session instead of steering when Multitask is on', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    conversations.setMultitask(true)
    await conversations.send('first turn')
    const sent = await conversations.send('review auth')
    expect(sent).toBe(true)
    const child = conversations.conversations.find(item => item.parentConversationId === parentId)
    expect(child?.kernel).toBe('dsh')
    expect(child?.messages[0]?.content).toBe('review auth')
    expect(conversations.activeId).toBe(parentId)
    expect(invokeCommand).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ conversationId: child?.id, prompt: 'review auth' }),
    )
    conversations.dispose()
  })

  it('stops a DSH native subagent without aborting the parent turn', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    const current = conversations.conversations.find(item => item.id === parentId)
    if (current) {
      Object.assign(current, {
        kernel: 'dsh',
        subagentTasks: [{ id: 'cf4fb9a2', role: '环境巡检', status: 'running' }],
      })
    }
    await conversations.abortWorkingItem('cf4fb9a2')
    expect(invokeCommand).toHaveBeenCalledWith(
      'abort_message',
      expect.objectContaining({ conversationId: parentId, subagentId: 'cf4fb9a2' }),
    )
    conversations.dispose()
  })

  it('does not spawn a child on Pi', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    conversations.setMultitask(true)
    expect(conversations.conversations.find(item => item.id === parentId)?.multitask).toBeUndefined()
    await conversations.send('first turn')
    const sent = await conversations.send('review auth')
    expect(sent).toBe(true)
    expect(conversations.conversations.some(item => item.parentConversationId === parentId)).toBe(false)
    expect(invokeCommand).toHaveBeenCalledWith(
      'steer_message',
      expect.objectContaining({ conversationId: parentId }),
    )
    conversations.dispose()
  })
})
