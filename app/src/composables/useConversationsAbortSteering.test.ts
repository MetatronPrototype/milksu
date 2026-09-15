// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

function storedConversation(id: string) {
  return { id, title: id, createdAt: 1, messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations abort confirmation', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // AbortMessage only submits the interrupt. If Pi never answers with a terminal
  // event the stop button stayed disabled forever; it must become retryable.
  it('releases the stop button when the engine never confirms the abort', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning.value).toBe(true)

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting.value).toBe(true)
    expect(conversations.activeAbortStalled.value).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAborting.value).toBe(false)
    expect(conversations.activeAbortStalled.value).toBe(true)

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting.value).toBe(true)
    expect(conversations.activeAbortStalled.value).toBe(false)
  })

  it('clears the stalled stop state once the turn actually settles', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.abort('conversation-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAbortStalled.value).toBe(true)

    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning.value).toBe(false)
    expect(conversations.activeAbortStalled.value).toBe(false)
  })
})

describe('useConversations steering delivery', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // A steering message must never disappear silently. When the turn settles
  // before Pi consumed it, it stays visible as an undelivered queue entry.
  it('keeps unconsumed steering visible when the turn settles', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.send('先保留修改')

    expect(conversations.activeMessageQueue.value.steering).toEqual(['先保留修改'])
    expect(conversations.activeMessageQueue.value.stalled).toBeUndefined()

    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeMessageQueue.value.steering).toEqual(['先保留修改'])
    expect(conversations.activeMessageQueue.value.stalled).toBe(true)
  })

  it('drops the undelivered marker once Pi reports an empty queue', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.send('先保留修改')
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeMessageQueue.value.stalled).toBe(true)

    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: [] })
    expect(conversations.activeMessageQueue.value.steering).toEqual([])
    expect(conversations.activeMessageQueue.value.stalled).toBeFalsy()
  })
})

describe('useConversations engine stop scoping', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // A session-less engine.stopped used to clear every running conversation.
  // A turn on another engine instance must keep its running state.
  it('keeps a concurrent turn on another engine running', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-pi', title: 'pi', createdAt: 1, kernel: 'pi', messages: [] },
      { id: 'conversation-dsh', title: 'dsh', createdAt: 2, kernel: 'dsh', messages: [] },
    ]
    await conversations.load()
    await conversations.listen()
    emit('conversation-pi', { type: 'assistant.started' })
    emit('conversation-dsh', { type: 'assistant.started' })
    expect([...conversations.runningConversationIds.value].sort())
      .toEqual(['conversation-dsh', 'conversation-pi'])

    emit('', { type: 'engine.stopped', engine: 'pi', sessions: ['conversation-pi'], error: 'sidecar exited' })
    expect(conversations.runningConversationIds.value).toEqual(['conversation-dsh'])
    const stopped = conversations.conversations.value.find(item => item.id === 'conversation-pi')
    const survivor = conversations.conversations.value.find(item => item.id === 'conversation-dsh')
    expect(String(stopped?.messages.at(-1)?.content)).toContain('Agent 已停止')
    expect(survivor?.messages.some(message => String(message.content).includes('Agent 已停止'))).toBe(false)
  })

  it('clears every session served by the stopped engine', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-pi-a', title: 'a', createdAt: 1, kernel: 'pi', messages: [] },
      { id: 'conversation-pi-b', title: 'b', createdAt: 2, kernel: 'pi', messages: [] },
    ]
    await conversations.load()
    await conversations.listen()
    emit('conversation-pi-a', { type: 'assistant.started' })
    emit('conversation-pi-b', { type: 'assistant.started' })
    expect(conversations.runningConversationIds.value).toHaveLength(2)

    emit('', {
      type: 'engine.protocol_error',
      engine: 'pi',
      sessions: ['conversation-pi-a', 'conversation-pi-b'],
      error: 'stream closed',
    })
    expect(conversations.runningConversationIds.value).toEqual([])
  })

  // Without an engine identity there is nothing safe to notify: broadcasting a
  // stop marked seven unrelated sessions as stopped on 2026-09-13.
  it('does not broadcast a stop that carries no session identity', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1'), storedConversation('conversation-2')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    emit('conversation-2', { type: 'assistant.started' })
    expect(conversations.runningConversationIds.value).toHaveLength(2)

    emit('', { type: 'engine.stopped', engine: 'pi', error: 'signal: killed' })

    expect([...conversations.runningConversationIds.value].sort())
      .toEqual(['conversation-1', 'conversation-2'])
    const messages = conversations.conversations.value.flatMap(item => item.messages)
    expect(messages.some(message => String(message.content).includes('Agent 已停止'))).toBe(false)
  })
})

describe('useConversations run-state recovery', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // The running marker used to be set only at assistant.started, so one cleared
  // marker hid the rest of a long turn. In-turn events must restore it.
  it('restores a running marker cleared by an engine stop', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.runningConversationIds.value).toEqual(['conversation-1'])

    emit('', { type: 'engine.stopped', engine: 'pi', sessions: ['conversation-1'], error: 'signal: killed' })
    expect(conversations.runningConversationIds.value).toEqual([])

    emit('conversation-1', { type: 'assistant.delta', text: '还在跑' })
    expect(conversations.runningConversationIds.value).toEqual(['conversation-1'])
  })

  it('restores the running marker from a tool event too', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', { type: 'tool.started', text: 'bash', toolName: 'bash', toolCallId: 'c1' })
    expect(conversations.runningConversationIds.value).toEqual(['conversation-1'])
  })

  // A session whose running marker was already gone still has to be told that its
  // engine died, otherwise that turn dies silently.
  it('covers sessions that only still show a running turn', async () => {
    const { projectEngineStopAffected } = await import('@/composables/useConversations')
    const runningTool = {
      id: 'm1',
      role: 'tool',
      content: 'sleep 600',
      timestamp: 1,
      toolName: 'bash',
      status: 'running',
    }
    const conversations = [
      { id: 'residue', title: 'r', createdAt: 1, kernel: 'pi', messages: [runningTool] },
      { id: 'marked', title: 'm', createdAt: 2, kernel: 'pi', messages: [] },
      { id: 'other-engine', title: 'o', createdAt: 3, kernel: 'dsh', messages: [runningTool] },
    ] as unknown as Parameters<typeof projectEngineStopAffected>[0]

    expect(projectEngineStopAffected(conversations, new Set(['marked']), 'pi'))
      .toEqual(['residue', 'marked'])
  })
})

describe('useConversations force stop', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Force stop is the third tier: it must only appear after two unanswered waits,
  // so a normal engine never shows it.
  it('upgrades to force stop only after two unanswered waits', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'
    emit('conversation-1', { type: 'assistant.started' })

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting.value).toBe(true)
    expect(conversations.activeAbortStalled.value).toBe(false)
    expect(conversations.activeForceStopReady.value).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAbortStalled.value).toBe(true)
    expect(conversations.activeForceStopReady.value).toBe(false)

    await conversations.abort('conversation-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeForceStopReady.value).toBe(true)
    expect(conversations.activeAbortStalled.value).toBe(false)
  })

  it('never offers force stop when the engine confirms', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'
    emit('conversation-1', { type: 'assistant.started' })

    await conversations.abort('conversation-1')
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.runningConversationIds.value).toEqual([])
    expect(conversations.activeForceStopReady.value).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(conversations.activeForceStopReady.value).toBe(false)
    expect(invokeCommand.mock.calls.some(([command]) => command === 'abort_session')).toBe(false)
  })

  it('force stop settles locally, clears queues, and lets the next send run', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'
    emit('conversation-1', { type: 'assistant.started' })
    emit('conversation-1', {
      type: 'tool.started',
      text: 'sleep 600',
      toolName: 'bash',
      toolCallId: 'call-1',
    })
    await conversations.send('引导一')
    expect(conversations.activeMessageQueue.value.steering).toEqual(['引导一'])

    await conversations.forceStopConversation('conversation-1')

    expect(conversations.runningConversationIds.value).toEqual([])
    // A force stop keeps what the user already wrote: the queue survives.
    expect(conversations.activeMessageQueue.value.steering).toEqual(['引导一'])
    const messages = conversations.conversations.value[0]?.messages ?? []
    expect(messages.some(message => String(message.content).includes('本轮已强制停止'))).toBe(true)
    expect(messages.some(message => message.role === 'tool' && message.status === 'running')).toBe(false)
    expect(invokeCommand.mock.calls.some(([command]) => command === 'abort_session')).toBe(true)

    await conversations.send('新回合')
    expect(conversations.runningConversationIds.value).toEqual(['conversation-1'])

    // "Lets the next send run" must mean the new turn's *content* lands, not just
    // the locally-set running marker.
    const beforeStream = conversations.conversations.value[0]?.messages.length ?? 0
    emit('conversation-1', { type: 'assistant.delta', text: '新回合内容' })
    const streamed = conversations.conversations.value[0]?.messages ?? []
    expect(streamed.length).toBeGreaterThan(beforeStream)
    expect(streamed.some(message => String(message.content).includes('新回合内容'))).toBe(true)
  })

  // The guard belongs to the force-stopped turn, not the conversation: a new send
  // must release it immediately or the fix reproduces the original symptom.
  it('lets a new turn stream after a force stop', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'
    emit('conversation-1', { type: 'assistant.started' })
    await conversations.forceStopConversation('conversation-1')

    await conversations.send('新回合')
    const before = conversations.conversations.value[0]?.messages.length ?? 0
    emit('conversation-1', { type: 'assistant.delta', text: '新回合的流式内容' })

    const messages = conversations.conversations.value[0]?.messages ?? []
    expect(messages.length).toBeGreaterThan(before)
    expect(messages.some(message => String(message.content).includes('新回合的流式内容'))).toBe(true)
  })

  // A late delta must not resurrect the turn that was force-stopped locally.
  it('drops late engine output for 30s after a force stop', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'
    emit('conversation-1', { type: 'assistant.started' })

    await conversations.forceStopConversation('conversation-1')
    const before = conversations.conversations.value[0]?.messages.length ?? 0

    emit('conversation-1', { type: 'assistant.delta', text: '幽灵输出' })
    expect(conversations.conversations.value[0]?.messages.length).toBe(before)
    expect(conversations.runningConversationIds.value).toEqual([])

    await vi.advanceTimersByTimeAsync(31_000)
    emit('conversation-1', { type: 'assistant.delta', text: '迟到输出' })
    expect(conversations.conversations.value[0]?.messages.length).toBeGreaterThan(before)
  })
})

describe("useConversations scheduled queue", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  it("injects one queued message into the running turn on demand", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("引导一")
    await conversations.send("引导二")
    expect(conversations.activeMessageQueue.value.steering).toEqual(["引导一", "引导二"])

    await expect(conversations.injectQueuedGuidance(0)).resolves.toBe(true)

    expect(invokeCommand).toHaveBeenCalledWith("steer_message", {
      conversationId: "conversation-1",
      prompt: "引导一",
    })
    expect(conversations.activeMessageQueue.value.steering).toEqual(["引导二"])
  })

  it("reorders queued messages with the drag indices", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("一")
    await conversations.send("二")
    await conversations.send("三")

    conversations.reorderQueuedGuidance(2, 0)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["三", "一", "二"])
  })
})

  it("does not auto-send the queue after the user stops the turn", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("排队一")

    await conversations.abort("conversation-1")
    emit("conversation-1", { type: "assistant.settled" })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(conversations.activeMessageQueue.value.steering).toEqual(["排队一"])
    expect(conversations.activeQueuedGuidanceInterrupted.value).toBe(true)
  })

  it("does not auto-send the queue after a force stop", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("排队一")

    await conversations.forceStopConversation("conversation-1")

    expect(conversations.activeMessageQueue.value.steering).toEqual(["排队一"])
    expect(conversations.activeQueuedGuidanceInterrupted.value).toBe(true)
  })

  it("restores the persisted queue after a reload", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("排队一")
    await conversations.send("排队二")

    // The record now carries the queue; a fresh store must read it back.
    stored = [{
      id: "conversation-1",
      title: "conversation-1",
      createdAt: 1,
      messages: [],
      messageQueue: { steering: ["排队一", "排队二"], followUp: [] },
    }]
    const reloaded = (await import("@/composables/useConversations")).useConversations()
    await reloaded.load()
    reloaded.activeId.value = "conversation-1"
    expect(reloaded.activeMessageQueue.value.steering).toEqual(["排队一", "排队二"])
  })

  it("delivers the queued message when the reader returns to a background conversation", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-a"), storedConversation("conversation-b")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-a"
    emit("conversation-a", { type: "assistant.started" })
    await conversations.send("排队一")

    // The turn ends while this conversation sits in the background.
    conversations.activeId.value = "conversation-b"
    emit("conversation-a", { type: "assistant.settled" })
    await new Promise(resolve => setTimeout(resolve, 0))
    const background = conversations.conversations.value.find(item => item.id === "conversation-a")
    expect(background?.messageQueue?.steering).toEqual(["排队一"])
    expect(background?.messages.some(message => message.content === "排队一")).toBe(false)

    // Returning to it delivers the top queued message immediately.
    conversations.activeId.value = "conversation-a"
    await vi.waitFor(() => {
      const resumed = conversations.conversations.value.find(item => item.id === "conversation-a")
      expect(resumed?.messages.at(-1)?.content).toBe("排队一")
    })
    const resumed = conversations.conversations.value.find(item => item.id === "conversation-a")
    expect(resumed?.messageQueue?.steering ?? []).toEqual([])
  })

describe("useConversations stopped queue", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  async function useQueuedConversations() {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("停止测试甲")
    await conversations.send("停止测试乙")
    return conversations
  }

  function sendCount() {
    return invokeCommand.mock.calls.filter(([command]) => command === "send_message").length
  }

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it("keeps the queue and sends nothing after a stop", async () => {
    const conversations = await useQueuedConversations()
    const before = sendCount()
    await conversations.abort("conversation-1")
    emit("conversation-1", { type: "assistant.settled" })
    await flush()
    expect(sendCount()).toBe(before)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["停止测试甲", "停止测试乙"])
    expect(conversations.activeQueuedGuidanceInterrupted.value).toBe(true)
  })

  it("keeps the queue and sends nothing after a force stop", async () => {
    const conversations = await useQueuedConversations()
    const before = sendCount()
    await conversations.forceStopConversation("conversation-1")
    emit("conversation-1", { type: "assistant.settled" })
    await flush()
    expect(sendCount()).toBe(before)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["停止测试甲", "停止测试乙"])
    expect(conversations.activeQueuedGuidanceInterrupted.value).toBe(true)
  })

  it("keeps the queue and sends nothing after an engine error", async () => {
    const conversations = await useQueuedConversations()
    const before = sendCount()
    emit("conversation-1", { type: "engine.error", error: "boom" })
    await flush()
    expect(sendCount()).toBe(before)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["停止测试甲", "停止测试乙"])
    expect(conversations.activeQueuedGuidanceInterrupted.value).toBe(true)
  })

  it("still advances the queue after a natural end", async () => {
    const conversations = await useQueuedConversations()
    const before = sendCount()
    emit("conversation-1", { type: "assistant.settled" })
    await flush()
    expect(sendCount()).toBe(before + 1)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["停止测试乙"])
  })
})

describe("useConversations injected guidance keeps the rest", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // Injection used to hand the whole queue to pi's echo, which ate every message
  // that was not the one just injected.
  it("keeps the remaining queued messages when one is injected", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("排队消息甲")
    await conversations.send("排队消息乙")
    await conversations.send("排队消息丙")

    await expect(conversations.injectQueuedGuidance(0)).resolves.toBe(true)
    emit("conversation-1", { type: "session.queue_updated", steering: ["排队消息甲"], followUp: [] })

    expect(conversations.activeMessageQueue.value.steering).toEqual(["排队消息乙", "排队消息丙"])
    const steerCalls = invokeCommand.mock.calls.filter(([command]) => command === "steer_message")
    expect(steerCalls).toHaveLength(1)
    // The running turn must survive the injection.
    expect(conversations.runningConversationIds.value).toEqual(["conversation-1"])
  })
})

describe("useConversations queue never reaches pi on its own", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  function steerCount() {
    return invokeCommand.mock.calls.filter(([command]) => command === "steer_message").length
  }

  // The renderer must never mirror its own queue into pi: only the explicit
  // "add to conversation" action may call steer_message.
  it("never steers while messages are only queued", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("V甲")
    await conversations.send("V乙")
    conversations.reorderQueuedGuidance(1, 0)
    emit("conversation-1", { type: "assistant.settled" })
    await flush()

    expect(steerCount()).toBe(0)
  })

  // A queue restored from disk must wait: it may only move when the reader acts.
  it("keeps a restored queue waiting after a restart", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [{
      id: "conversation-1",
      title: "conversation-1",
      createdAt: 1,
      messages: [],
      messageQueue: { steering: ["V甲", "V乙"], followUp: [] },
    }]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    await flush()

    expect(conversations.activeMessageQueue.value.steering).toEqual(["V甲", "V乙"])
    expect(steerCount()).toBe(0)
    expect(invokeCommand.mock.calls.filter(([command]) => command === "send_message")).toHaveLength(0)
  })

  it("keeps the injected label when pi echoes an empty queue", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("V甲")
    await conversations.send("V乙")
    await conversations.injectQueuedGuidance(0)
    emit("conversation-1", { type: "session.queue_updated", steering: [], followUp: [] })

    expect(conversations.activeInjectedGuidance.value).toEqual(["V甲"])
    expect(conversations.activeMessageQueue.value.steering).toEqual(["V乙"])
  })
})

describe("useConversations restored queue never advances", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  function sendCount() {
    return invokeCommand.mock.calls.filter(([command]) => command === "send_message").length
  }

  function storedQueue() {
    const saves = invokeCommand.mock.calls.filter(([command]) => command === "save_conversation")
    const last = saves.at(-1)?.[1] as { conversation?: { messageQueue?: { steering?: string[] } } } | undefined
    return last?.conversation?.messageQueue?.steering
  }

  async function restoredConversation() {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [{
      id: "conversation-1",
      title: "conversation-1",
      createdAt: 1,
      messages: [],
      messageQueue: { steering: ["R甲", "R乙"], followUp: [] },
    }]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    return conversations
  }

  // A queue that came from disk must never move on its own, not even when a turn
  // happens to end normally in this process.
  it("keeps a restored queue when a turn ends normally", async () => {
    const conversations = await restoredConversation()
    emit("conversation-1", { type: "assistant.started" })
    emit("conversation-1", { type: "assistant.settled" })
    await flush()

    expect(sendCount()).toBe(0)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["R甲", "R乙"])
  })

  it("shows the same queue that is stored on disk", async () => {
    const conversations = await restoredConversation()
    // Queue while a turn is running: that is the path that only adds to the queue.
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("R丙")
    await flush()

    expect(conversations.activeMessageQueue.value.steering).toEqual(["R甲", "R乙", "R丙"])
    expect(storedQueue()).toEqual(["R甲", "R乙", "R丙"])
  })
})

describe("useConversations restored queue clears pi", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // pi persists the steering it was handed, so a restored queue can still sit in pi
  // from the previous run. When the session comes back, MilkSU must drop it.
  it("clears pi's queue when a restored session becomes ready", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [{
      id: "conversation-1",
      title: "conversation-1",
      createdAt: 1,
      messages: [],
      messageQueue: { steering: ["R甲"], followUp: [] },
    }]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"

    emit("conversation-1", { type: "session.ready" })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(invokeCommand).toHaveBeenCalledWith("clear_queued_messages", {
      conversationId: "conversation-1",
    })
    // The message stays with the reader: only pi's copy is dropped.
    expect(conversations.activeMessageQueue.value.steering).toEqual(["R甲"])
  })
})

describe("useConversations normal session ready", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // Only a queue restored from disk may trigger the pi-side cleanup.
  it("leaves a session without a restored queue alone", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"

    emit("conversation-1", { type: "session.ready" })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(
      invokeCommand.mock.calls.filter(([command]) => command === "clear_queued_messages"),
    ).toHaveLength(0)
  })
})

describe("useConversations stop keeps the whole queue visible", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  function storedQueue() {
    const saves = invokeCommand.mock.calls.filter(([command]) => command === "save_conversation")
    const last = saves.at(-1)?.[1] as { conversation?: { messageQueue?: { steering?: string[] } } } | undefined
    return last?.conversation?.messageQueue?.steering
  }

  // Real-machine sequence: a restored queue plus freshly queued messages, then a stop.
  // Everything must stay visible and stored - nothing may silently disappear.
  it("keeps restored and new messages together after a stop", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [{
      id: "conversation-1",
      title: "conversation-1",
      createdAt: 1,
      messages: [],
      messageQueue: { steering: ["C甲", "C乙", "C丙", "prompt-C"], followUp: [] },
    }]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "session.ready" })
    await flush()
    expect(conversations.activeMessageQueue.value.steering)
      .toEqual(["C甲", "C乙", "C丙", "prompt-C"])

    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("QB甲")
    await conversations.send("QB乙")
    expect(conversations.activeMessageQueue.value.steering)
      .toEqual(["C甲", "C乙", "C丙", "prompt-C", "QB甲", "QB乙"])

    await conversations.abort("conversation-1")
    emit("conversation-1", { type: "assistant.settled" })
    await flush()

    const expected = ["C甲", "C乙", "C丙", "prompt-C", "QB甲", "QB乙"]
    expect(conversations.activeMessageQueue.value.steering).toEqual(expected)
    expect(storedQueue()).toEqual(expected)
    expect(conversations.activeQueuedGuidanceInterrupted.value).toBe(true)
  })
})

describe("useConversations injected guidance visibility", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  // The injected message used to be invisible everywhere: it must appear in the
  // transcript, marked, while the remaining queue keeps its order.
  it("shows the injected message in the transcript and keeps the rest queued", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("Q甲")
    await conversations.send("Q乙")
    await conversations.send("Q丙")

    await conversations.injectQueuedGuidance(0)
    await flush()

    const messages = conversations.conversations.value[0]?.messages ?? []
    const injected = messages.find(message => message.content === "Q甲" && message.fromQueuedGuidance)
    expect(injected).toBeDefined()
    expect(injected?.role).toBe("user")
    expect(conversations.activeMessageQueue.value.steering).toEqual(["Q乙", "Q丙"])
    // The running turn is untouched.
    expect(conversations.runningConversationIds.value).toEqual(["conversation-1"])
  })
})

describe("useConversations withdraw a queued message", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  function storedQueue() {
    const saves = invokeCommand.mock.calls.filter(([command]) => command === "save_conversation")
    const last = saves.at(-1)?.[1] as { conversation?: { messageQueue?: { steering?: string[] } } } | undefined
    return last?.conversation?.messageQueue?.steering
  }

  // Withdrawing used to go through pi's queue, so when pi did not hold the message the
  // whole call threw and nothing changed. It must withdraw locally, always.
  it("withdraws the message in memory, on disk and in the panel", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("QC甲")
    await conversations.send("QC乙")
    await conversations.send("QC丙")

    await conversations.cancelQueuedGuidance(1)
    await flush()

    expect(conversations.activeMessageQueue.value.steering).toEqual(["QC甲", "QC丙"])
    expect(storedQueue()).toEqual(["QC甲", "QC丙"])
    expect(
      invokeCommand.mock.calls.filter(([command]) => command === "remove_queued_message"),
    ).toHaveLength(0)
  })

  // Withdrawing something that is no longer queued must fail visibly, not silently.
  it("reports a failed withdrawal of an already merged message", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    await conversations.send("QD甲")
    await conversations.send("QD乙")
    await conversations.injectQueuedGuidance(0)
    await flush()

    await expect(conversations.cancelQueuedGuidance(5)).resolves.toBe(false)
    expect(conversations.activeMessageQueue.value.steering).toEqual(["QD乙"])
  })
})
describe("useConversations queue stays one source of truth", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  function storedQueue() {
    const saves = invokeCommand.mock.calls.filter(([command]) => command === "save_conversation")
    const last = saves.at(-1)?.[1] as { conversation?: { messageQueue?: { steering?: string[] } } } | undefined
    return last?.conversation?.messageQueue?.steering
  }

  // Every queue operation must move the shown queue and the stored queue together.
  it("keeps the shown queue equal to the stored queue through add, reorder and inject", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })

    await conversations.send("Q甲")
    await conversations.send("Q乙")
    await conversations.send("Q丙")
    await flush()
    expect(conversations.activeMessageQueue.value.steering).toEqual(["Q甲", "Q乙", "Q丙"])
    expect(storedQueue()).toEqual(["Q甲", "Q乙", "Q丙"])

    conversations.reorderQueuedGuidance(2, 0)
    await flush()
    expect(conversations.activeMessageQueue.value.steering).toEqual(["Q丙", "Q甲", "Q乙"])
    expect(storedQueue()).toEqual(["Q丙", "Q甲", "Q乙"])

    await conversations.injectQueuedGuidance(0)
    await flush()
    expect(conversations.activeMessageQueue.value.steering).toEqual(["Q甲", "Q乙"])
    expect(storedQueue()).toEqual(["Q甲", "Q乙"])
    expect(conversations.activeInjectedGuidance.value).toEqual(["Q丙"])
  })
})

describe("useConversations idle engine reclaim", () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // Reclaiming an idle sidecar is engine housekeeping: it must not write "Agent stopped"
  // into the conversation, which made the reader think their turn had been killed.
  it("keeps an idle reclaim out of the transcript", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    emit("conversation-1", { type: "assistant.settled" })
    const before = conversations.conversations.value[0]?.messages.length ?? 0

    // No sessionId: that is the engine-scoped path this behaviour lives on.
    handlers.get("engine-event")?.({ payload: { type: "engine.stopped", reason: "parked-reap", sessions: ["conversation-1"] } })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(conversations.conversations.value[0]?.messages.length).toBe(before)
    expect(conversations.engineNotice.value).toContain("引擎已回收")
  })

  it("still reports a real engine stop in the transcript", async () => {
    const { useConversations } = await import("@/composables/useConversations")
    const conversations = useConversations()
    stored = [storedConversation("conversation-1")]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = "conversation-1"
    emit("conversation-1", { type: "assistant.started" })
    const before = conversations.conversations.value[0]?.messages.length ?? 0

    handlers.get("engine-event")?.({ payload: { type: "engine.stopped", reason: "shutdown-pi", error: "boom", sessions: ["conversation-1"] } })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((conversations.conversations.value[0]?.messages.length ?? 0)).toBeGreaterThan(before)
  })
})

describe('useConversations cross-conversation delivery ownership', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  async function setupRunningTarget() {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-a'), storedConversation('conversation-b')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-a'
    emit('conversation-a', { type: 'assistant.started' })
    emit('conversation-b', { type: 'assistant.started' })
    return conversations
  }

  // b-ownership-1 / b-ownership-4: the target is named at send time. The view sits on A
  // while B is the target, and the entry must land on B - never on whoever is on screen.
  it('delivers to the named target while a different conversation is on screen', async () => {
    const conversations = await setupRunningTarget()

    const delivered = await conversations.deliverAgentMessage({
      targetConversationId: 'conversation-b',
      text: '来自 A 的投递',
      origin: { conversationId: 'conversation-a', conversationTitle: '会话 A', agent: 'Agent' },
    })

    expect(delivered).toBe(true)
    // Positive: B holds it.
    conversations.activeId.value = 'conversation-b'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversations.activeMessageQueue.value.steering).toEqual(['来自 A 的投递'])
    // Negative: the conversation that was on screen at send time stays empty.
    conversations.activeId.value = 'conversation-a'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversations.activeMessageQueue.value.steering).toEqual([])
  })

  // b-ownership-2: switching views right after the delivery must not move the entry.
  it('keeps the ownership when the view switches immediately after sending', async () => {
    const conversations = await setupRunningTarget()

    const pending = conversations.deliverAgentMessage({
      targetConversationId: 'conversation-b',
      text: '切换前投递',
      origin: { conversationId: 'conversation-a', conversationTitle: '会话 A', agent: 'Agent' },
    })
    conversations.activeId.value = 'conversation-a'
    await pending
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(conversations.activeMessageQueue.value.steering).toEqual([])
    conversations.activeId.value = 'conversation-b'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversations.activeMessageQueue.value.steering).toEqual(['切换前投递'])
  })

  // b-ownership-3: the stored conversation carries the origin, so a restart restores the
  // same ownership from disk instead of recomputing it from the visible view.
  it('stores the origin with the message it belongs to', async () => {
    const conversations = await setupRunningTarget()

    await conversations.deliverAgentMessage({
      targetConversationId: 'conversation-b',
      text: '落库归属',
      origin: { conversationId: 'conversation-a', conversationTitle: '会话 A', agent: 'Agent' },
    })
    await new Promise(resolve => setTimeout(resolve, 400))

    const saved = invokeCommand.mock.calls
      .filter(([command]) => command === 'save_conversation')
      .map(([, args]) => args as { conversation?: { id?: string; messageQueue?: unknown } })
      .filter(entry => entry?.conversation?.id === 'conversation-b')
    expect(saved.length).toBeGreaterThan(0)
    const persisted = JSON.stringify(saved.at(-1))
    expect(persisted).toContain('落库归属')
  })
})

describe('useConversations agent delivery event', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // The backend announces a delivery; the renderer files it under the target named in
  // the event. No view switch is involved anywhere on this path.
  it('files an announced delivery under the target conversation', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-a'), storedConversation('conversation-b')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-a'
    emit('conversation-b', { type: 'assistant.started' })

    handlers.get('agent-delivery')?.({
      payload: {
        targetConversationId: 'conversation-b',
        text: '事件投递',
        origin: { conversationId: 'conversation-a', conversationTitle: '会话 A', agent: 'Agent' },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(conversations.activeMessageQueue.value.steering).toEqual([])
    conversations.activeId.value = 'conversation-b'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversations.activeMessageQueue.value.steering).toEqual(['事件投递'])
  })
})

describe('useConversations agent delivery guards', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // Only the same workspace: an agent must not reach into another project.
  it('refuses a delivery from another workspace', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-a', title: 'A', createdAt: 1, messages: [], workspacePath: '/tmp/one' },
      { id: 'conversation-b', title: 'B', createdAt: 1, messages: [], workspacePath: '/tmp/two' },
    ]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-a'
    emit('conversation-b', { type: 'assistant.started' })

    const delivered = await conversations.deliverAgentMessage({
      targetConversationId: 'conversation-b',
      text: '越界投递',
      origin: { conversationId: 'conversation-a', conversationTitle: 'A', agent: 'Agent' },
    })

    expect(delivered).toBe(false)
    conversations.activeId.value = 'conversation-b'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversations.activeMessageQueue.value.steering).toEqual([])
  })

  // A pair of conversations must not be able to flood each other.
  it('stops a delivery flood between the same two conversations', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-a'), storedConversation('conversation-b')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-a'
    emit('conversation-b', { type: 'assistant.started' })

    const results: boolean[] = []
    for (let index = 0; index < 7; index += 1) {
      results.push(await conversations.deliverAgentMessage({
        targetConversationId: 'conversation-b',
        text: `洪水 ${index}`,
        origin: { conversationId: 'conversation-a', conversationTitle: 'A', agent: 'Agent' },
      }))
    }

    expect(results.filter(Boolean).length).toBe(5)
    expect(results.at(-1)).toBe(false)
  })
})

describe('useConversations blocked deletion notice', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // The guard refuses without asking, so the reader must still see that nothing ran.
  it('shows a status line when a deletion is refused and nothing when it is not', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    expect(conversations.engineNotice.value).toBe('')

    emit('conversation-1', {
      type: 'destructive.blocked',
      notice: 'MilkSU 无法安全解析删除目标中的变量或命令替换：$X',
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(conversations.engineNotice.value).toContain('已拦截一条删除命令')
    expect(conversations.engineNotice.value).toContain('未执行')
    expect(conversations.engineNotice.value).toContain('$X')
    // It is a status line, not a message in the conversation.
    expect(conversations.conversations.value[0]?.messages.length).toBe(0)
    expect(conversations.engineNoticeRepeat.value).toBe(1)
  })

  // A burst of identical refusals is one line with a count, not a screenful.
  it('merges a repeated refusal instead of adding another line', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    for (let index = 0; index < 3; index += 1) {
      emit('conversation-1', { type: 'destructive.blocked', notice: '同一条原因' })
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    expect(conversations.engineNoticeRepeat.value).toBe(3)
    expect(conversations.conversations.value[0]?.messages.length).toBe(0)

    // A different reason starts a new line.
    emit('conversation-1', { type: 'destructive.blocked', notice: '另一条原因' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conversations.engineNotice.value).toContain('另一条原因')
    expect(conversations.engineNoticeRepeat.value).toBe(1)
  })

  // The credential refusals (spent, mismatching, expired, never reviewed) use the same path.
  it('shows the credential refusals through the same path', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId.value = 'conversation-1'

    emit('conversation-1', {
      type: 'destructive.blocked',
      notice: 'MilkSU refused this deletion: it has no reviewed approval left',
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(conversations.engineNotice.value).toContain('已拦截一条删除命令')
    expect(conversations.engineNotice.value).toContain('no reviewed approval left')
    expect(conversations.conversations.value[0]?.messages.length).toBe(0)
  })
})
