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
  conversations.store.setState({
    conversations: [{ id: 'conversation-1', title: '探针', kernel: 'pi', messages: [] }],
  } as never)
  return conversations
}

// 模型来源失败必须**被读到读者眼前**：侧车把整句放进 notice，引擎原样转发，
// 渲染层唯一的活就是把它说出来。以前引擎把它改名成 engine.raw.… ✗ ⇒ 界面没有分支
// ⇒ 读者只看到“它不说话”（真事）。
describe('a model-source failure reaches the reader', () => {
  beforeEach(async () => {
    handlers.clear()
    const { applyUiLocale } = await import('@/lib/uiLocale')
    applyUiLocale('zh')
  })

  it('shows the sentence the engine forwarded', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ engineNotice: '' })
    emitEngineEvent({
      sessionId: 'conversation-1',
      type: 'session.model_source_unavailable',
      reason: 'selected-source-unavailable',
      notice: '模型调用失败：所选来源不可用（tokenflux / deepseek/deepseek-flash）。请检查该来源的设置后重试。',
    })
    expect(conversations.store.getState().engineNotice).toContain('模型调用失败')
    expect(conversations.store.getState().engineNotice).toContain('tokenflux')
  })

  it('falls back to the message field when notice is missing', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ engineNotice: '' })
    emitEngineEvent({
      sessionId: 'conversation-1',
      type: 'session.model_source_unavailable',
      message: '模型调用失败：账号来源不可用。',
    })
    expect(conversations.store.getState().engineNotice).toContain('账号来源不可用')
  })

  it('stays quiet when the payload carries no sentence at all', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'session.model_source_unavailable' })
    expect(conversations.store.getState().engineNotice ?? '').toBe('')
  })
})
