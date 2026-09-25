// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from '@/desktop'

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



  it('别的对话的告警不会串到当前对话的横幅', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-2',
      type: 'guard.alarm',
      notice: '已拦截：另一个会话的事。',
      noticeEnglish: 'Blocked: another conversation.',
      protectedPath: true,
      turnStopped: true,
    } })
    // 当前对话（conversation-1）不该出现横幅；出事的是 conversation-2。
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    expect(conversations.conversationHasProblem('conversation-2')).toBe(true)
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
      protectedPath: true,
      turnStopped: true,
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('已停止本轮')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })

  // 读者口径（最终确认）：**只要被拦就上顶部横幅 + 侧栏红叉**，不再分"单次拒绝/停轮"。
  it('普通的单次拒绝（没停轮）：同样上顶部横幅 + 红叉', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已拦截：这个目录在你的设置里被标记为「agent 不可改写」。',
      noticeEnglish: 'Blocked: this folder is on your protected list in Settings.',
      protectedPath: true,
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('已拦截')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })



  it('该对话开新一回合 ⇒ 标记消除；别的对话不受影响', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
      protectedPath: true,
      turnStopped: true,
    } })
    expect(conversations.activeProblemTurn).not.toBeNull()
    // 别的对话也先亮着：不能被“当前对话开新回合”误清。
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-2',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
      protectedPath: true,
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

  // 读者要求：横幅上要有「知道了」按钮，点了立刻消除；同时“发下一条消息也消”照旧。
  it('点「知道了」⇒ 问题标记立刻消除（侧栏红叉同时灭）', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
      protectedPath: true,
      turnStopped: true,
    } })
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    conversations.dismissProblemTurn()
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
  })


  // 读者要求：复读告警也“一起做”——上顶栏 + 红叉（不再走那条 12 秒就消失的提示）。
  it('思考复读告警 ⇒ 上顶栏 + 红叉（和受限路径同一套）', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '检测到这一步的思考在复读（连续 8 行完全相同）。这一步中途无法中止，只能先把情况告诉你。',
      noticeEnglish: 'This thinking step is repeating itself (8 identical lines in a row).',
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('复读')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
  })


  /** 一个"重启后从记录里读回来"的对话：只有落盘的 agentProblem，没有任何事件。 */
  function storedProblemConversation() {
    return {
      id: 'conversation-1',
      title: 'blocked before restart',
      createdAt: 1,
      kernel: 'dsh',
      messages: [],
      agentProblem: { notice: '已停止本轮：…', noticeEnglish: 'Stopped this turn: …', at: 1 },
    }
  }

  // 落盘路径（读者要的"重启后仍保留"）：事件早就过去了 ⇒ 界面必须靠记录里的 agentProblem
  // 显示横幅 + 红叉。（Work 那笔只加了 Go 侧测试，这条前端回归是我补的。）
  it('重启后：记录里带着 agentProblem ⇒ 横幅 + 红叉仍然显示（不靠任何事件）', async () => {
    const conversations = await loadRuntime()
    conversations.conversations = [storedProblemConversation()]
    expect(conversations.activeProblemTurn?.notice).toContain('已停止本轮')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })

  it('点「知道了」⇒ 调引擎命令清落盘记录，本地也立刻清', async () => {
    const conversations = await loadRuntime()
    conversations.conversations = [storedProblemConversation()]
    const invoke = vi.mocked(invokeCommand)
    invoke.mockClear()
    conversations.dismissProblemTurn()
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    // 不清落盘那份 ⇒ 重开 App 横幅会回来 ✗（读者点的是"知道了"）。
    expect(invoke).toHaveBeenCalledWith('clear_conversation_problem', { conversationId: 'conversation-1' })
  })

})
