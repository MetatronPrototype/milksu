// @vitest-environment jsdom

// 搬运自本地分支（C）：跨对话提示是"合并 + 可关闭 + 按对话过滤"的只读条目。
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async () => null),
  listenEvent: vi.fn(async () => () => undefined),
}))

describe('cross-conversation notices', () => {
  it('folds a burst from one source into a single counted entry', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.activeId = 'conversation-target'

    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-target',
      sourceId: 'conversation-source',
      sourceTitle: '来源会话',
      kind: 'request',
      summary: '第一条',
      at: 1_000,
    })
    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-target',
      sourceId: 'conversation-source',
      sourceTitle: '来源会话',
      kind: 'request',
      summary: '第二条',
      at: 2_000,
    })

    const notices = conversations.activeCrossConversationNotices
    expect(notices).toHaveLength(1)
    expect(notices[0]?.count).toBe(2)
    // 合并后保留同一个 id，所以"关闭"关掉的是整条。
    expect(notices[0]?.id).toBe('cross-notice-conversation-target-conversation-source')
    // 最后一条的摘要覆盖前一条（只留一行）。
    expect(notices[0]?.summary).toBe('第二条')
  })

  it('keeps one line only and only for the conversation that received it', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.activeId = 'conversation-target'

    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-target',
      sourceId: 'source-a',
      kind: 'result',
      summary: `  换\n行   和   多空格 ${'x'.repeat(200)}  `,
    })
    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-other',
      sourceId: 'source-b',
      kind: 'not-applied',
      summary: '别的对话的提示',
    })

    const notices = conversations.activeCrossConversationNotices
    expect(notices).toHaveLength(1)
    expect(notices[0]?.sourceId).toBe('source-a')
    expect(notices[0]?.kind).toBe('result')
    expect(notices[0]?.summary).toHaveLength(120)
    expect(notices[0]?.summary).not.toContain('\n')
    expect(notices[0]?.summary.startsWith('换 行 和 多空格 xxx')).toBe(true)
  })

  it('dismisses exactly the entry that was asked to close', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.activeId = 'conversation-target'

    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-target',
      sourceId: 'source-a',
      summary: 'a',
    })
    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-target',
      sourceId: 'source-b',
      summary: 'b',
    })
    expect(conversations.activeCrossConversationNotices).toHaveLength(2)

    conversations.dismissCrossConversationNotice('cross-notice-conversation-target-source-a')
    const left = conversations.activeCrossConversationNotices
    expect(left).toHaveLength(1)
    expect(left[0]?.sourceId).toBe('source-b')
  })

  it('ignores a notice that names no source, and never touches the transcript', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.activeId = 'conversation-target'

    conversations.pushCrossConversationNotice({
      conversationId: 'conversation-target',
      sourceId: '   ',
      summary: '没有来源',
    })
    expect(conversations.activeCrossConversationNotices).toHaveLength(0)
    // 它是通知，不是消息：绝不能混进 messages（否则会到达模型）。
    const target = conversations.conversations.find(item => item.id === 'conversation-target')
    expect(target?.messages ?? []).toHaveLength(0)
  })
})
