// @vitest-environment jsdom

// 搬运自本地分支（C）：后端只校验+喊话，真正把消息送进目标对话并回执是渲染层的活。
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

function emitDelivery(payload: Record<string, unknown>) {
  handlers.get('agent-delivery')?.({ payload })
}

function conversation(id: string, messages: Record<string, unknown>[] = []) {
  return { id, title: id, createdAt: 1, workspacePath: '/tmp/project', messages }
}

describe('cross-conversation delivery', () => {
  beforeEach(() => {
    handlers.clear()
    commandCalls.length = 0
    stored = [conversation('conversation-source'), conversation('conversation-target')]
  })

  it('lands the delivered message in the target, reports the truth, and does not move the user', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-source'

    emitDelivery({
      targetConversationId: 'conversation-target',
      text: '目标对话，这是结果',
      origin: {
        conversationId: 'conversation-source',
        conversationTitle: '来源会话',
        agent: 'MilkSU agent',
        deliveredAt: 1_700_000_000_000,
      },
      kind: 'result',
      requestId: 'request-1',
    })
    await vi.waitFor(() => {
      expect(commandCalls.some(call => call.command === 'settle_agent_delivery')).toBe(true)
    })

    // 消息真的落到了目标对话里。
    const target = conversations.conversations.find(item => item.id === 'conversation-target')
    const delivered = target?.messages ?? []
    expect(delivered).toHaveLength(1)
    // 信封必须在最前面：侧车用 trimStart().startsWith() 判定这一轮的内容是外来的。
    expect(String(delivered[0]?.content ?? '').startsWith('[MilkSU-XCONV]')).toBe(true)
    expect(String(delivered[0]?.content ?? '')).toContain('目标对话，这是结果')
    // 来源写在消息上，界面据此显示来源徽标。
    expect(delivered[0]?.origin).toMatchObject({ conversationId: 'conversation-source' })

    // 回执说的是真话：这一条确实送达了。
    const settle = commandCalls.find(call => call.command === 'settle_agent_delivery')?.args
    expect(settle).toMatchObject({
      conversationId: 'conversation-source',
      requestId: 'request-1',
      status: 'delivered',
    })

    // 工具承诺过"不会把用户挪到那个对话"——用户仍在来源对话上。
    expect(conversations.activeId).toBe('conversation-source')

    // 到达提示只挂在收到消息的那个对话上。
    conversations.activeId = 'conversation-target'
    const notices = conversations.activeCrossConversationNotices
    expect(notices).toHaveLength(1)
    expect(notices[0]?.sourceId).toBe('conversation-source')
    expect(notices[0]?.kind).toBe('result')
    expect(notices[0]?.summary).toBe('目标对话，这是结果')
  })

  it('ignores a malformed event instead of settling or delivering anything', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-source'

    // 没有目标 / 没有正文的事件不该产生任何副作用。
    emitDelivery({ targetConversationId: '', text: '无处可去', requestId: 'request-x' })
    emitDelivery({ targetConversationId: 'conversation-target', text: '   ', requestId: 'request-y' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(commandCalls.some(call => call.command === 'settle_agent_delivery')).toBe(false)
    const target = conversations.conversations.find(item => item.id === 'conversation-target')
    expect(target?.messages ?? []).toHaveLength(0)
  })
})
