// @vitest-environment jsdom

// 远端设备发起的回合：后端把提示词写进对话存档，并广播 remote-turn-started，因为渲染
// 进程不是这句话的作者。不接这个事件，打开的对话只会显示回复（读者看不到远端刚发的
// 那句话），而且渲染进程下一次防抖保存会用自己那份消息列表整体覆盖存档、把提示词删掉；
// 存档一丢，远端页面轮询刷新时那条用户气泡也跟着消失。
import { beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []
const commandCalls: { command: string; args: unknown }[] = []

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string, args?: unknown) => {
    commandCalls.push({ command, args })
    if (command === 'list_conversations') return stored
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function emitRemoteTurn(payload: Record<string, unknown>) {
  handlers.get('remote-turn-started')?.({ payload })
}

function conversation(id: string, messages: Record<string, unknown>[] = []) {
  return { id, title: id, createdAt: 1, workspacePath: '/tmp/project', messages }
}

async function mount() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  return conversations
}

type Mounted = Awaited<ReturnType<typeof mount>>

function messagesOf(conversations: Mounted, id: string) {
  return conversations.conversations.find(item => item.id === id)?.messages ?? []
}

describe('remote-started turn prompt', () => {
  beforeEach(() => {
    handlers.clear()
    stored = []
    commandCalls.length = 0
  })

  it('shows the prompt the remote device sent, and persists it', async () => {
    stored = [conversation('conversation-1')]
    const conversations = await mount()

    emitRemoteTurn({
      conversationId: 'conversation-1',
      message: { id: 'remote-prompt-1', role: 'user', content: '从手机发的消息', timestamp: 1_700_000_000_000 },
    })

    const messages = messagesOf(conversations, 'conversation-1')
    expect(messages.map(message => message.id)).toEqual(['remote-prompt-1'])
    // 后端写的这条消息没有 status（旧记录）。归一化必须把它当成 done，否则它不会渲染成气泡。
    expect(messages[0]?.status).toBe('done')

    await vi.waitFor(() => {
      expect(commandCalls.some(call => call.command === 'save_conversation')).toBe(true)
    })
    // 渲染进程从这一刻起拥有这份对话（后端会停止代录），所以它保存的内容里必须包含
    // 远端那句提示词——否则下一次保存就把它覆盖掉了。
    const saved = commandCalls.find(call => call.command === 'save_conversation')?.args as {
      conversation?: { messages?: { id?: string }[] }
    }
    expect(saved.conversation?.messages?.map(message => message.id)).toContain('remote-prompt-1')
  })

  it('ignores a duplicate broadcast instead of adding the prompt twice', async () => {
    stored = [conversation('conversation-1')]
    const conversations = await mount()

    const payload = {
      conversationId: 'conversation-1',
      message: { id: 'remote-prompt-1', role: 'user', content: '从手机发的消息', timestamp: 1_700_000_000_000 },
    }
    emitRemoteTurn(payload)
    emitRemoteTurn(payload)

    expect(messagesOf(conversations, 'conversation-1').map(message => message.id)).toEqual(['remote-prompt-1'])
  })

  it('inserts the prompt before this turn output when the event arrives late', async () => {
    stored = [conversation('conversation-1', [
      { id: 'earlier-user', role: 'user', content: '早先的问题', timestamp: 1_699_999_999_000, status: 'done' },
      { id: 'earlier-reply', role: 'assistant', content: '早先的回答', timestamp: 1_699_999_999_500, status: 'done' },
      // 这一轮的输出已经在内存里了：它比提示词更晚。
      { id: 'this-turn-reply', role: 'assistant', content: '远端这一轮的回复', timestamp: 1_700_000_000_900, status: 'done' },
    ])]
    const conversations = await mount()

    emitRemoteTurn({
      conversationId: 'conversation-1',
      message: { id: 'remote-prompt-1', role: 'user', content: '从手机发的消息', timestamp: 1_700_000_000_000 },
    })

    // 提示词落在上一轮回合之后、本轮输出之前——不能排到本轮回复下面去。
    expect(messagesOf(conversations, 'conversation-1').map(message => message.id)).toEqual([
      'earlier-user',
      'earlier-reply',
      'remote-prompt-1',
      'this-turn-reply',
    ])
  })

  it('does nothing for a conversation this renderer does not hold', async () => {
    stored = [conversation('conversation-1')]
    const conversations = await mount()

    emitRemoteTurn({
      conversationId: 'conversation-other',
      message: { id: 'remote-prompt-1', role: 'user', content: '别的对话', timestamp: 1_700_000_000_000 },
    })

    expect(messagesOf(conversations, 'conversation-1')).toEqual([])
    expect(commandCalls.some(call => call.command === 'save_conversation')).toBe(false)
  })

  it('ignores a non-user message, so a forged payload cannot inject a reply', async () => {
    stored = [conversation('conversation-1')]
    const conversations = await mount()

    emitRemoteTurn({
      conversationId: 'conversation-1',
      message: { id: 'forged-1', role: 'assistant', content: '伪造的回复', timestamp: 1_700_000_000_000 },
    })

    expect(messagesOf(conversations, 'conversation-1')).toEqual([])
  })
})
