// @vitest-environment jsdom
// R4 桌面可见性：引擎韧性批次五个新事件（model.retry / model.stall / turn.active /
// session.recovery / session.message_queued）从桌面事件流进渲染器状态的接线。
// 事件形状 = Go normalizeBridgeEvent 的输出（internal/engine/supervisor.go 五个新 case）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelRetryLabel } from '@/lib/agentEngineSignals'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return stored
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function storedConversation(id: string, title = id) {
  return { id, title, createdAt: 1, workspacePath: '', messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations 引擎韧性事件', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
    Object.defineProperty(window, 'milksu', { configurable: true, value: { invoke: vi.fn() } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function runtime(running = true) {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1', '韧性会话')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'
    if (running) emit('conversation-1', { type: 'assistant.started' })
    return conversations
  }

  it('model.retry start 挂横幅带倒计时，end 只熄秒数不收横幅；engine.error 才收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 3_000,
    })
    expect(conversations.activeModelRetry).toMatchObject({
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      errorMessage: 'fetch failed',
      inFlight: false,
    })
    // 退避节奏明说在文案里（β.192 真机验收：裸数字「2.0s」被读成重试间隔过短）。
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('3 秒后重试')

    // 倒计时归零、下一次尝试开始（phase:end）：横幅保留，只熄秒数。
    // 旧语义在此删条目 ⇒ 读者在下一次尝试的静默里以为死机而重复发送。
    emit('conversation-1', { type: 'model.retry', phase: 'end', attempt: 2 })
    expect(conversations.activeModelRetry).not.toBeNull()
    expect(conversations.activeModelRetry).toMatchObject({
      attempt: 2,
      inFlight: true,
      retryAt: 0,
    })
    const inFlightLabel = modelRetryLabel(conversations.activeModelRetry!)
    expect(inFlightLabel).toContain('正在重试…')
    expect(inFlightLabel).not.toContain('秒后')

    // 最终错误 ⇒ 收横幅；条目是真删（不是被 running 门挡住）——新回合 running 回来也不诈尸。
    emit('conversation-1', { type: 'engine.error', error: 'x' })
    expect(conversations.activeModelRetry).toBeNull()
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('回合成功收尾也收横幅：assistant.completed（消息落定）先收，下一回合不诈尸', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    emit('conversation-1', { type: 'model.retry', phase: 'end', attempt: 1 })
    expect(conversations.activeModelRetry).not.toBeNull()
    // 重试的那条消息落定 = 出结果 ⇒ 横幅收起（多段回合里早于 assistant.settled）。
    emit('conversation-1', { type: 'assistant.completed', text: '好的' })
    expect(conversations.activeModelRetry).toBeNull()
    // 排队消息续跑的第二轮（新回合）⇒ 上一轮的横幅状态不能再上屏。
    emit('conversation-1', { type: 'assistant.settled' })
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('同一会话多轮退避无缝衔接：end→start 整条替换，倒计时从新 retryAt 重走', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      notice: '网络波动，重试中 1/5',
      noticeEnglish: 'Network trouble, retrying 1/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 2_000,
    })
    emit('conversation-1', { type: 'model.retry', phase: 'end', attempt: 1 })
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 1, inFlight: true })
    // 第二次尝试又失败、排程第二轮退避：横幅全程不消失，计数与倒计时无缝换新。
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 4_000,
    })
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 2, inFlight: false })
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('2/5，4 秒后重试')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('3 秒后重试')
    // 倒计时走完但 end 事件还没到 ⇒ 不报「0 秒后重试」，按正在重试兜底。
    await vi.advanceTimersByTimeAsync(3_000)
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('正在重试…')
    expect(modelRetryLabel(conversations.activeModelRetry!)).not.toContain('秒后')
  })

  it('引擎实例停止（回合被中断）收横幅：engine.stopped 这条路不走 finishRun，同处清条目', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    expect(conversations.activeModelRetry).not.toBeNull()
    // session-less 引擎停止：把该实例服务的会话全部结算（含重试横幅条目）。
    emit('', { type: 'engine.stopped', sessions: ['conversation-1'] })
    expect(conversations.activeModelRetry).toBeNull()
    // 条目已删：新回合 running 回来不诈尸。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('畸形 phase（既非 start 也非 end）⇒ 按旧口径收横幅，不猜语义', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    emit('conversation-1', { type: 'model.retry', phase: '???', attempt: 1 })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('model.retry 算进展：重试开始即刷新停滞时钟，退避静默不误判停滞', async () => {
    const conversations = await runtime()
    // 静默 20s（超过 quietMs=18s）⇒ 界面已说「等待中」。
    await vi.advanceTimersByTimeAsync(20_000)
    expect(conversations.streamStale).toBe(true)
    // 重试开始：引擎刚说过话（管理中的静默），停滞时钟清零 + 心跳喂上。
    emit('conversation-1', { type: 'model.retry', phase: 'start', attempt: 1, maxRetries: 5 })
    expect(conversations.streamStale).toBe(false)
    expect(conversations.activeEngineAlive).toBe(true)
    // 退避期内安静 17s（仍在 quietMs 内）⇒ 不算停滞。
    await vi.advanceTimersByTimeAsync(17_000)
    expect(conversations.streamStale).toBe(false)
    // 长退避（60s，超过 quietMs 但未到 modelStallMs=120s）：真实引擎在此期间会继续发
    // turn.heartbeat（进程活着、请求在重试）⇒ 不举「停滞/进程没了」牌。
    await vi.advanceTimersByTimeAsync(60_000)
    emit('conversation-1', { type: 'turn.heartbeat' })
    expect(conversations.activeStallKind).toBe('')
  })

  it('turn.active 作为心跳源：回合边界证明引擎活着', async () => {
    const conversations = await runtime()
    emit('conversation-1', { type: 'turn.active', phase: 'start' })
    expect(conversations.activeEngineAlive).toBe(true)
    emit('conversation-1', { type: 'turn.active', phase: 'end' })
    expect(conversations.activeEngineAlive).toBe(true)
    // 心跳宽限（15s）过了才算不活着——但 turn.active 不推进进展时钟。
    await vi.advanceTimersByTimeAsync(20_000)
    expect(conversations.activeEngineAlive).toBe(false)
    expect(conversations.streamStale).toBe(true)
  })

  it('session.recovery 挂恢复横幅、把会话标回进行中并清失败横幅', async () => {
    const conversations = await runtime()
    // 崩溃：回合失败，running 清掉，失败横幅挂起。
    emit('conversation-1', { type: 'engine.error', error: 'fetch failed' })
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.activeProblemTurn).not.toBeNull()
    // 引擎重开附着、run 仍在飞行 ⇒ 恢复可见。
    emit('conversation-1', {
      type: 'session.recovery',
      notice: '从断点恢复中',
      noticeEnglish: 'Resuming from where the engine left off',
    })
    expect(conversations.activeEngineRecovery?.notice).toBe('从断点恢复中')
    // running 位回到真实状态（agentRecovery 的恢复按钮以 running 为门 ⇒ 不双横幅）。
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.activeProblemTurn).toBeNull()
    // 恢复的回合收尾 ⇒ 恢复横幅随之收起。
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeEngineRecovery).toBeNull()
  })

  it('session.message_queued 挂排队提示；被回合消费即收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'session.message_queued',
      submissionId: 'sub-1',
      position: 2,
      total: 3,
      text: '排队消息',
      notice: '排队中第 2 位',
    })
    expect(conversations.activeQueuedMessage).toMatchObject({
      position: 2,
      total: 3,
      text: '排队消息',
    })
    // queue_update：followUp 里还有它 ⇒ 保持。
    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: ['别的消息', '排队消息'] })
    expect(conversations.activeQueuedMessage).not.toBeNull()
    // 消费掉（followUp 里没了）⇒ 收横幅。
    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: ['别的消息'] })
    expect(conversations.activeQueuedMessage).toBeNull()
  })

  it('session.message_queued 的回合结束兜底：running 清掉即收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'session.message_queued',
      position: 1,
      total: 1,
      text: '排队消息',
    })
    expect(conversations.activeQueuedMessage).not.toBeNull()
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeQueuedMessage).toBeNull()
  })

  it('model.stall 复用停滞告警面：自带「连接无响应 x 秒」并立刻举牌', async () => {
    const conversations = await runtime()
    // 引擎进程还活着（心跳在）。
    emit('conversation-1', { type: 'turn.heartbeat' })
    emit('conversation-1', {
      type: 'model.stall',
      stallStage: 'generation',
      stalledSeconds: 90,
      hardKillSeconds: 180,
      notice: '连接无响应 90 秒',
      noticeEnglish: 'No response from the model connection for 90s',
    })
    expect(conversations.activeStallKind).toBe('model-stalled')
    expect(conversations.activeEngineWarning).toMatchObject({
      notice: '连接无响应 90 秒',
      stalledSeconds: 90,
      hardKillSeconds: 180,
    })
    // 真实事件到来 ⇒ 告警过期。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeEngineWarning).toBeNull()
    expect(conversations.activeStallKind).toBe('')
  })
})
