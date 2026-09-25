// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUARD_NOTICE_TTL_MS } from '@/composables/useConversations'

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

  // 读者原话：提示不该常驻——「我给你发了新对话之后那个提示会一直在最下方显示，
  // 只要我不点「知道了」它就不会消失」。看一眼（10–15 秒）就够，然后自己消失 ✓。
  it('守卫示警到点自己消失，不靠读者动手', async () => {
    const conversations = await loadRuntime()
    vi.useFakeTimers()
    try {
      handlers.get('engine-event')?.({ payload: {
        sessionId: 'conversation-1',
        type: 'guard.alarm',
        notice: '已停止本轮：agent 连续 3 次试图写入受限路径（…）。',
        noticeEnglish: 'Stopped this turn: …',
      } })
      expect(conversations.activeGuardNotices.length).toBe(1)
      vi.advanceTimersByTime(GUARD_NOTICE_TTL_MS - 500)
      expect(conversations.activeGuardNotices.length).toBe(1)
      vi.advanceTimersByTime(1000)
      expect(conversations.activeGuardNotices.length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // 「被守卫停轮」比「普通拒绝」严重：前者要在顶部常驻横幅 + 侧栏红叉（读者口径：
  // 该对话开新一回合就消）。
  it('被守卫停轮 ⇒ 该对话标记为「遇到问题」（顶部横幅 + 侧栏红叉）', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：agent 连续 3 次试图写入受限路径（…）。',
      noticeEnglish: 'Stopped this turn: …',
      turnStopped: true,
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('已停止本轮')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })

  it('普通的单次拒绝（没停轮）不亮「遇到问题」', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已拦截：这个目录在你的设置里被标记为「agent 不可改写」。',
      noticeEnglish: 'Blocked: this folder is on your protected list in Settings.',
    } })
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
  })

  it('该对话开新一回合 ⇒ 标记消除；别的对话不受影响', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
      turnStopped: true,
    } })
    expect(conversations.activeProblemTurn).not.toBeNull()
    // 别的对话也先亮着：不能被“当前对话开新回合”误清。
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-2',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
      turnStopped: true,
    } })
    handlers.get('engine-event')?.({ payload: { sessionId: 'conversation-1', type: 'assistant.started' } })
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    expect(conversations.conversationHasProblem('conversation-2')).toBe(true)
  })

  // 读者补充：「Agent 运行失败」也会让对话停住 ⇒ 同样要亮红叉 + 顶部常驻横幅。
  it('「Agent 运行失败」也算这一轮没能正常继续 ⇒ 亮红叉 + 顶部横幅', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'engine.error',
      error: 'terminated',
      done: true,
    } })
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.activeProblemTurn?.notice).toContain('运行失败')
  })

  it('用户主动停下的那种（aborted/cancelled）不算问题', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'engine.error',
      error: 'aborted',
      done: true,
    } })
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    expect(conversations.activeProblemTurn).toBeNull()
  })

  it('12 秒内再来一次同样内容 ⇒ 续期并合并计数', async () => {
    const conversations = await loadRuntime()
    vi.useFakeTimers()
    try {
      const payload = {
        sessionId: 'conversation-1',
        type: 'guard.alarm',
        notice: '已拦截：这个目录在你的设置里被标记为「agent 不可改写」。',
        noticeEnglish: 'Blocked: this folder is on your protected list in Settings.',
      }
      handlers.get('engine-event')?.({ payload })
      vi.advanceTimersByTime(GUARD_NOTICE_TTL_MS - 1000)
      handlers.get('engine-event')?.({ payload })
      expect(conversations.activeGuardNotices.length).toBe(1)
      expect(conversations.activeGuardNotices[0].count).toBe(2)
      // 续期后，第一次的到期时刻不该把它清掉。
      vi.advanceTimersByTime(2000)
      expect(conversations.activeGuardNotices.length).toBe(1)
      vi.advanceTimersByTime(GUARD_NOTICE_TTL_MS)
      expect(conversations.activeGuardNotices.length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
