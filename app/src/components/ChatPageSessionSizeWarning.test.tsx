// @vitest-environment jsdom
// 会话过胖预警 UI 回归：超过阈值必须在界面上说清楚，且**不阻断**（可压缩、可继续用）。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/types'

const runtimeStub = {
  activeProblemTurn: null as unknown,
  conversations: [] as Conversation[],
  pendingWorkspaceHome: null as unknown,
  forceStopConversation: vi.fn(),
  wakeStuckTurn: vi.fn(async () => true),
  toggleDshPlanMode: () => undefined,
  streamStaleSeconds: 0,
  streamStale: false,
  activeStallKind: '' as '' | 'engine-gone' | 'model-stalled',
  store: { subscribe: () => () => undefined, getSnapshot: () => ({}) },
  setMultitask: () => undefined,
  selectedMultitask: false,
  runningConversationIds: [] as string[],
  dismissProblemTurn: () => undefined,
  dismissCrossConversationNotice: () => undefined,
  busySend: false,
  activeToolRunning: false,
  activeQueuedBehind: null as string | null,
  activeId: 'fat-conversation',
  activeForceStopReady: false,
  activeEngineAlive: true,
  activeCrossConversationNotices: [] as unknown[],
  abortWorkingItem: () => undefined,
  abortWorkingAll: () => undefined,
}

vi.mock('@/stores/conversationsStore', () => ({
  useConversations: () => runtimeStub,
  ConversationsProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock('@/desktop', async importOriginal => {
  const actual = await importOriginal<typeof import('@/desktop')>()
  return {
    ...actual,
    invokeCommand: () => new Promise(() => undefined),
    listenEvent: () => Promise.resolve(() => undefined),
  }
})

vi.mock('@/modelCatalog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/modelCatalog')>()
  return {
    ...actual,
    useLiveModelCatalog: () => ({
      snapshot: { providers: [], relay: null, includeUnconfigured: false },
      providers: [],
      providerGroups: [],
      pickerGroups: [],
      providerModelLabel: () => '',
      pickerModelLabel: () => '',
    }),
  }
})

const mountedRoots: Root[] = []

class FakeResizeObserver {
  constructor(_callback: () => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
class FakeIntersectionObserver {
  constructor(_callback: () => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

function conversationWith(chars: number): Conversation {
  return {
    id: 'fat-conversation',
    title: '很大的会话',
    createdAt: 0,
    messages: [
      { id: 'u-1', role: 'user', content: 'x'.repeat(chars), timestamp: 1 },
      { id: 'a-1', role: 'assistant', content: 'done', timestamp: 2 },
    ],
  }
}

async function renderChatPage(chars: number, onCompactContext?: () => void) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const ChatPage = (await import('@/components/ChatPage')).default
  const conversation = conversationWith(chars)
  runtimeStub.conversations = [conversation]
  runtimeStub.activeId = conversation.id
  await act(async () => {
    root.render(
      <ChatPage
        conversation={conversation}
        settings={null}
        workspacePath="/tmp/probe"
        running={false}
        aborting={false}
        sessionReady
        resumed={false}
        compacting={false}
        ctfSession={false}
        ensureConversation={() => conversation.id}
        onCompactContext={onCompactContext}
      />,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  return host
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
  if (typeof CSS === 'undefined') (globalThis as unknown as Record<string, unknown>).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as unknown as Record<string, unknown>).escape = (value: string) => value
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

describe('ChatPage 会话过胖预警呈现', () => {
  it('stays silent below the threshold', async () => {
    const host = await renderChatPage(64 * 1024)
    expect(host.querySelector('[data-testid="session-size-warning"]')).toBeNull()
  })

  it('shows a non-blocking banner above the threshold with the size and advice', async () => {
    const host = await renderChatPage(2.5 * 1024 * 1024)
    const banner = host.querySelector('[data-testid="session-size-warning"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('请求容易超时')
    expect(banner?.textContent).toContain('压缩')
    expect(banner?.textContent).toContain('新开')
    expect(banner?.textContent).toContain('MB')
  })

  it('offers Compact, and the conversation stays usable', async () => {
    const onCompact = vi.fn()
    const host = await renderChatPage(2.5 * 1024 * 1024, onCompact)
    const button = host.querySelector('[data-testid="session-size-compact"]') as HTMLElement | null
    expect(button).not.toBeNull()
    await act(async () => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onCompact).toHaveBeenCalledTimes(1)
    // 预警不是阻断：横幅只是提示，可继续用。
    expect(host.querySelector('[data-testid="session-size-warning"]')).not.toBeNull()
  })

  it('“知道了” dismisses the banner without blocking anything else', async () => {
    const host = await renderChatPage(2.5 * 1024 * 1024)
    const dismiss = host.querySelector('[data-testid="session-size-dismiss"]') as HTMLElement | null
    expect(dismiss).not.toBeNull()
    await act(async () => { dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(host.querySelector('[data-testid="session-size-warning"]')).toBeNull()
  })
})
