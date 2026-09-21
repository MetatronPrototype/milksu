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

  // 事故现场：读者把一条排程引导"加入对话"之后，本地排程又派发同一段文本 ⇒
  // app 会话里就出现了两条相同气泡（真机：相隔 2-3 秒），而引擎其实只收到一条。
  it('does not append a second copy when the schedule dispatches text already injected', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['第一条'])
    expect(await conversations.injectQueuedGuidance(0)).toBe(true)
    const injected = conversations.conversations
      .find(item => item.id === 'conversation-1')?.messages ?? []
    expect(injected).toHaveLength(1)
    expect(injected[0]).toMatchObject({ content: '第一条', fromQueuedGuidance: true })

    // 排程随后照常派发同一段文本：这一轮正在跑，所以走的是 steering 分支。
    conversations.store.setState({ runningIds: new Set(['conversation-1']) })
    await conversations.send('第一条')

    // ① 转写里该正文恰 1 条 —— 派发不许再追加第二份。
    const messages = conversations.conversations
      .find(item => item.id === 'conversation-1')?.messages ?? []
    expect(messages.filter(item => item.role === 'user' && item.content === '第一条')).toHaveLength(1)
  })

  // ② 派发本身必须照旧发生（上次我提前 return 短路了它，被 20 条既有用例拦下）。
  it('still dispatches the scheduled text to the engine', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['第一条'])
    expect(await conversations.injectQueuedGuidance(0)).toBe(true)
    commandCalls.length = 0
    conversations.store.setState({ runningIds: new Set(['conversation-1']) })
    await conversations.send('第一条')
    expect(commandCalls.some(call => call.command === 'steer_message')).toBe(true)
  })

  // ③ 队列不许把已经并进本轮的文本再收回来（截图里「⏱ …已并入本回合」的来源）。
  it('does not put an already injected guidance back into the queue', async () => {
    const { conversations } = await loadRuntime()
    seedQueue(conversations, ['第一条', '第二条'])
    expect(await conversations.injectQueuedGuidance(0)).toBe(true)
    expect(queueOf(conversations)).toEqual(['第二条'])
    conversations.store.setState({ runningIds: new Set(['conversation-1']) })
    await conversations.send('第一条')
    // 只剩没被注入的那条；别的条目要留着，命中的那条不许回来。
    expect(queueOf(conversations)).toEqual(['第二条'])
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

// 真机数据定位的真因：读者**先直接发出**同一句话（send() 直发），随后又点「加入对话」⇒
// 注入路径再无脑追加一条 ⇒ 同文本两条（引擎其实只收到一条 = 纯显示重复）。
describe('guidance already sent directly', () => {
  it('does not append a second copy when the same text was just sent directly', async () => {
    const { conversations } = await loadRuntime()
    // 1) 先直接发出（这条路径是直发；会话是否在跑由其它用例的共享状态决定，与本用例无关）
    await conversations.send('测试')
    // 清掉计数：③ 只关心"注入这一次"有没有额外多发（不许靠"少发一次"变绿）。
    commandCalls.length = 0
    // 2) 再把它放进排程并点「加入对话」
    seedQueue(conversations, ['测试'])
    expect(await conversations.injectQueuedGuidance(0)).toBe(true)

    // ① 转录里该正文恰 1 条 —— 不许再追加第二份。
    const messages = conversations.conversations
      .find(item => item.id === 'conversation-1')?.messages ?? []
    expect(messages.filter(item => item.role === 'user' && item.content === '测试')).toHaveLength(1)
    // ② 可见性没被牺牲：「已加入本轮」列表照旧写上。
    expect(conversations.activeInjectedGuidance).toEqual(['测试'])
    // ③ 不许靠"少发一次"来变绿：直发仍然只发生一次。
    expect(commandCalls.filter(call => call.command === 'steer_message')).toHaveLength(1)
  })

  // 注：注入路径的查重**只**看最近 30 秒内同文本的 user 消息；更早的同名文本不该被误判。
  it('still appends when the same text is older than the window', async () => {
    const { conversations } = await loadRuntime()
    await conversations.send('旧话')
    const target = conversations.conversations.find(item => item.id === 'conversation-1')
    if (target) {
      target.messages = target.messages.map(message => ({ ...message, timestamp: Date.now() - 60_000 }))
    }
    seedQueue(conversations, ['旧话'])
    expect(await conversations.injectQueuedGuidance(0)).toBe(true)
    const messages = conversations.conversations
      .find(item => item.id === 'conversation-1')?.messages ?? []
    expect(messages.filter(item => item.role === 'user' && item.content === '旧话')).toHaveLength(2)
  })
})
