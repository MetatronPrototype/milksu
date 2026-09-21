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

function emitEngineEvent(payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload })
}

async function loadRuntime() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return conversations
}

// 被拦下的删除命令：提示句里的"原因"来自侧车（`bridge.js` 的 `{ notice: decision.reason }`），
// 只带一种语言。严格同语言 ⇒ 句子与其中的可变部分必须同语言。
// ⚠️ 下面 (a) 里的中文原因是**夹具构造**（喂进去的），不是真机复现：真机上引擎多给英文原因。
const CHINESE_REASON = '引擎拒绝了这条删除：rm -rf /'
const ENGLISH_REASON = 'The engine refused this delete: rm -rf /'

describe('blocked-delete notice language', () => {
  beforeEach(async () => {
    handlers.clear()
    const { applyUiLocale } = await import('@/lib/uiLocale')
    applyUiLocale('zh')
  })

  // (a) 英文界面 + 中文原因 ⇒ 提示里**不能出现任何汉字**（英文句 + 中文词就是混排）。
  it('never puts a Chinese reason into the English notice', async () => {
    const { applyUiLocale } = await import('@/lib/uiLocale')
    const conversations = await loadRuntime()
    applyUiLocale('en')
    emitEngineEvent({ sessionId: 'conversation-1', type: 'destructive.blocked', notice: CHINESE_REASON })
    const notice = conversations.store.getState().engineNotice ?? ''
    expect(notice).toContain('Refused a delete command')
    expect(notice).not.toMatch(/[\u4e00-\u9fff]/)
  })

  // (b) 回归保护：中文界面 + 英文原因 ⇒ 不出现英文整句（现状已经是对的，别改坏）。
  it('keeps the English sentence out of the Chinese notice', async () => {
    const conversations = await loadRuntime()
    emitEngineEvent({ sessionId: 'conversation-1', type: 'destructive.blocked', notice: ENGLISH_REASON })
    const notice = conversations.store.getState().engineNotice ?? ''
    expect(notice).toContain('已拦截一条删除命令')
    expect(notice).not.toContain('Refused a delete command')
  })

  // (c) 回归保护：中文界面 + 中文原因 ⇒ **仍要带上原因**（别把中文一起删掉）。
  it('still shows a Chinese reason in the Chinese notice', async () => {
    const conversations = await loadRuntime()
    emitEngineEvent({ sessionId: 'conversation-1', type: 'destructive.blocked', notice: CHINESE_REASON })
    const notice = conversations.store.getState().engineNotice ?? ''
    expect(notice).toContain('已拦截一条删除命令')
    expect(notice).toContain(CHINESE_REASON)
  })

  // (d) 原因为空 ⇒ 干净的无变量版（中英各自成形）。
  it('falls back to the plain sentence when there is no reason', async () => {
    const { applyUiLocale } = await import('@/lib/uiLocale')
    const conversations = await loadRuntime()
    emitEngineEvent({ sessionId: 'conversation-1', type: 'destructive.blocked', notice: '' })
    expect(conversations.store.getState().engineNotice ?? '').toBe('已拦截一条删除命令 —— 未执行。')
    applyUiLocale('en')
    emitEngineEvent({ sessionId: 'conversation-1', type: 'destructive.blocked', notice: '' })
    expect(conversations.store.getState().engineNotice ?? '').toBe('Refused a delete command - nothing ran.')
  })
})
