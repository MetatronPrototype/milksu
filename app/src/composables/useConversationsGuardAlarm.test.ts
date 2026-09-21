// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { payload: unknown }) => void
const handlers = new Map<string, Handler>()

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'list_conversations') return []
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

async function loadRuntime() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return conversations
}

// 引擎守卫的示警必须能上屏（这就是 cross-layer 的 app 半边：名字对、字段对、真的显示）。
describe('engine guard alarms reach the reader', () => {
  beforeEach(async () => {
    handlers.clear()
    const { applyUiLocale } = await import('@/lib/uiLocale')
    applyUiLocale('zh')
  })

  it('shows the Chinese notice of a guard.alarm in a Chinese interface', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '这一步思考陷入重复，已跳过。',
      noticeEnglish: 'This thinking step started repeating, so it was skipped.',
    } })
    expect(conversations.engineNotice).toContain('这一步思考陷入重复')
  })

  it('shows the English notice in an English interface', async () => {
    const { applyUiLocale } = await import('@/lib/uiLocale')
    const conversations = await loadRuntime()
    applyUiLocale('en')
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '这一步思考陷入重复，已跳过。',
      noticeEnglish: 'This thinking step started repeating, so it was skipped.',
    } })
    expect(conversations.engineNotice).toContain('This thinking step started repeating')
  })
})
