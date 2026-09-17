// @vitest-environment jsdom

// 搬运自本地分支（A 引导）：把排队中的引导并进正在跑的这一轮，以及拖动重排、被打断标记。
import { beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []
const commandCalls: { command: string; args: unknown }[] = []
let failSteer = false

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string, args?: unknown) => {
    commandCalls.push({ command, args })
    if (command === 'list_conversations') return stored
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    if (command === 'steer_message' && failSteer) throw new Error('引擎拒绝了这条引导')
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function conversation(id: string, kernel = 'pi') {
  return { id, title: id, createdAt: 1, workspacePath: '/tmp/project', kernel, messages: [] }
}

type Runtime = Awaited<ReturnType<typeof loadRuntime>>['conversations']

async function loadRuntime() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return { conversations }
}

function seedQueue(conversations: Runtime, steering: string[]) {
  conversations.store.setState({
    messageQueues: new Map([['conversation-1', { steering, followUp: [] }]]),
  })
}

function queueOf(conversations: Runtime) {
  return conversations.store.getState().messageQueues.get('conversation-1')?.steering ?? []
}

describe('queued guidance', () => {
  beforeEach(() => {
    handlers.clear()
    commandCalls.length = 0
    failSteer = false
    stored = [conversation('conversation-1')]
  })

  it('injects a queued message into the running turn and shows it in the transcript', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['第一条', '第二条'])

    expect(await conversations.injectQueuedGuidance(0)).toBe(true)

    // 引擎收到的就是那条文本。
    expect(commandCalls.find(call => call.command === 'steer_message')?.args)
      .toMatchObject({ conversationId: 'conversation-1', prompt: '第一条' })
    // 队列里只剩没被加入的那条。
    expect(queueOf(conversations)).toEqual(['第二条'])
    // 已经加入本轮的引导要显示出来，免得看起来像凭空消失。
    expect(conversations.activeInjectedGuidance).toEqual(['第一条'])
    // 转写里留一条标记过的用户消息（来源是排队引导）。
    const messages = conversations.conversations
      .find(item => item.id === 'conversation-1')?.messages ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ content: '第一条', fromQueuedGuidance: true })
  })

  it('refuses to inject on a kernel that cannot take mid-turn steering', async () => {
    stored = [conversation('conversation-1', 'dsh')]
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['第一条'])

    expect(await conversations.injectQueuedGuidance(0)).toBe(false)
    expect(commandCalls.some(call => call.command === 'steer_message')).toBe(false)
    expect(queueOf(conversations)).toEqual(['第一条'])
  })

  it('keeps the queue untouched and says why when the engine refuses', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['第一条'])
    failSteer = true

    expect(await conversations.injectQueuedGuidance(0)).toBe(false)
    // 失败的整个操作不落地：队列原样，也没有被标记成"已加入"。
    expect(queueOf(conversations)).toEqual(['第一条'])
    expect(conversations.activeInjectedGuidance).toEqual([])
    // 但它要说真话：原因写进转写。
    const messages = conversations.conversations
      .find(item => item.id === 'conversation-1')?.messages ?? []
    expect(String(messages[0]?.content ?? '')).toContain('引导未加入当前回合')
  })

  it('reorders queued guidance and ignores out-of-range moves', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['a', 'b', 'c'])

    conversations.reorderQueuedGuidance(0, 2)
    expect(queueOf(conversations)).toEqual(['b', 'c', 'a'])

    conversations.reorderQueuedGuidance(9, 0)
    conversations.reorderQueuedGuidance(1, 1)
    expect(queueOf(conversations)).toEqual(['b', 'c', 'a'])
  })

  it('marks the queue as interrupted when a turn is force-stopped with guidance still waiting', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['还在等'])
    expect(conversations.activeQueuedGuidanceInterrupted).toBe(false)

    await conversations.forceStopConversation('conversation-1')

    // 队列里排着的东西不会照常跑，界面必须说出来。
    expect(conversations.activeQueuedGuidanceInterrupted).toBe(true)
    // 手动加入 = 读者接管 → 队列重新被信任。
    expect(await conversations.injectQueuedGuidance(0)).toBe(true)
    expect(conversations.activeQueuedGuidanceInterrupted).toBe(false)
  })
})
