// @vitest-environment jsdom

import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatPage from './ChatPage.vue'
import type { Conversation, Message } from '@/types'

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error('desktop runtime unavailable in component test')
  }),
  listenEvent: vi.fn(async () => () => undefined),
}))

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

/** A long thread whose last message is waiting for a decision. */
function longConversationWithApproval(messageCount: number): Conversation {
  const messages: Message[] = Array.from({ length: messageCount }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `第 ${index} 条`,
    timestamp: index,
    status: 'done' as const,
  }))
  messages.push({
    id: 'approval-1',
    role: 'assistant' as const,
    content: 'rm -rf /Users/me/backups/old',
    timestamp: messageCount + 1,
    status: 'done' as const,
    toolName: 'bash',
    approvalRequestId: 'approval-1',
    approvalState: 'pending' as const,
  })
  return { id: 'conversation-long', title: 'long', createdAt: 1, messages }
}

function mountPage(initial: Conversation) {
  const active = ref<Conversation>(initial)
  const decisions: unknown[][] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { ChatPage },
    setup: () => ({ active, running: false, decisions }),
    template: `<ChatPage
      :conversation="active"
      :settings="null"
      workspace-path="/tmp/milksu"
      :running="running"
      :aborting="false"
      :session-ready="true"
      :resumed="false"
      :compacting="false"
      :ctf-session="false"
      :ensure-conversation="() => active.id"
      @respond-approval="(...args) => decisions.push(args)"
    />`,
  })
  app.mount(host)
  mountedApps.push(app)
  return { host, decisions }
}

describe('ChatPage approval bar', () => {
  // The card inside a 3000-message thread could not be clicked; the decision must live
  // in its own light-weight bar that never waits for the transcript to re-render.
  it('shows a clickable approval bar above a 3000-message transcript', async () => {
    vi.useFakeTimers()
    const { host, decisions } = mountPage(longConversationWithApproval(3000))
    await nextTick()
    await nextTick()

    const bar = host.querySelector('[data-testid="approval-bar"]')
    expect(bar).not.toBeNull()
    // It is not part of the batched transcript list.
    expect(host.querySelectorAll('.agent-thread [data-testid="approval-bar"]').length).toBe(0)

    const allow = host.querySelector<HTMLButtonElement>('[data-testid="approval-bar-allow"]')
    expect(allow).not.toBeNull()
    allow?.click()
    await nextTick()

    // Feedback is immediate: the bar switches to "working" and the decision is emitted.
    expect(host.querySelector('[data-testid="approval-bar-submitting"]')).not.toBeNull()
    expect(decisions).toEqual([['approval-1', true, 'once']])
  })

  it('rolls the bar back when the engine never confirms the decision', async () => {
    vi.useFakeTimers()
    const { host } = mountPage(longConversationWithApproval(3000))
    await nextTick()
    await nextTick()

    host.querySelector<HTMLButtonElement>('[data-testid="approval-bar-allow"]')?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="approval-bar-submitting"]')).not.toBeNull()

    await vi.advanceTimersByTimeAsync(9000)
    await nextTick()
    expect(host.querySelector('[data-testid="approval-bar-submitting"]')).toBeNull()
    expect(host.textContent).toContain('审批未确认')
  })

  it('has no bar when nothing is waiting for a decision', async () => {
    const conversation = longConversationWithApproval(20)
    conversation.messages.at(-1)!.approvalState = 'approved'
    const { host } = mountPage(conversation)
    await nextTick()
    await nextTick()
    expect(host.querySelector('[data-testid="approval-bar"]')).toBeNull()
  })
})
