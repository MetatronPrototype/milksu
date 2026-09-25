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

  // 真事：拦截会把回合停掉，而状态行（engineNotice）会被后续状态覆盖 ⇒ 读者眼前只剩
  // 「这一轮没有可见正文」，连发生了什么都得问。所以示警必须另写一条**持久**条目。
  it('把守卫示警写进转写里的持久条目（状态行被覆盖后仍在）', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：agent 连续 3 次试图写入受限路径（/tmp/example/out）。写入都没有发生。',
      noticeEnglish: 'Stopped this turn: the agent tried 3 times to write a protected path.',
    } })
    expect(conversations.activeGuardNotices.length).toBe(1)
    expect(conversations.activeGuardNotices[0].notice).toContain('已停止本轮')
    expect(conversations.activeGuardNotices[0].noticeEnglish).toContain('Stopped this turn')
    // 状态行会被下一条通知顶掉（它只有一个槽位）：拿另一类引擎通知顶掉它，
    // 这条持久条目必须还在 —— 这就是修它的全部理由。
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'attachment.held',
      notice: '有一张附件没有发出去。',
      noticeEnglish: 'One attachment was not sent.',
    } })
    expect(conversations.engineNotice).toContain('有一张附件')
    expect(conversations.activeGuardNotices.length).toBe(1)
    expect(conversations.activeGuardNotices[0].notice).toContain('已停止本轮')
  })

  it('同内容的重复示警合并计数，不刷屏', async () => {
    const conversations = await loadRuntime()
    for (let index = 0; index < 2; index += 1) {
      handlers.get('engine-event')?.({ payload: {
        sessionId: 'conversation-1',
        type: 'guard.alarm',
        notice: '已拦截：这个目录在你的设置里被标记为「agent 不可改写」。',
        noticeEnglish: 'Blocked: this folder is on your protected list in Settings.',
      } })
    }
    expect(conversations.activeGuardNotices.length).toBe(1)
    expect(conversations.activeGuardNotices[0].count).toBe(2)
  })

  it('别的会话的示警不会串到当前会话', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-2',
      type: 'guard.alarm',
      notice: '已拦截：另一个会话的事。',
      noticeEnglish: 'Blocked: another conversation.',
    } })
    expect(conversations.activeGuardNotices.length).toBe(0)
  })

  it('读者可以关掉这条提示', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已拦截：…',
      noticeEnglish: 'Blocked: …',
    } })
    conversations.dismissGuardNotice(conversations.activeGuardNotices[0].id)
    expect(conversations.activeGuardNotices.length).toBe(0)
  })
})
