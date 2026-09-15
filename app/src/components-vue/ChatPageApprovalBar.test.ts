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

function mountPage(
  initial: Conversation,
  extra: { engineNotice?: string; engineNoticeRepeat?: number } = {},
) {
  const active = ref<Conversation>(initial)
  const decisions: unknown[][] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { ChatPage },
    setup: () => ({ active, running: false, decisions, extra }),
    template: `<ChatPage
      :conversation="active"
      :settings="null"
      workspace-path="/tmp/milksu"
      :running="running"
      :aborting="false"
      :session-ready="true"
      :engine-notice="extra.engineNotice"
      :engine-notice-repeat="extra.engineNoticeRepeat"
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
    vi.useRealTimers()
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
    // Mounting 3000 messages is the point of the test, so it needs more than the 5s default.
  }, 30_000)

  // A 3000-message fixture put this case right at the 5s default timeout; the timing is
  // what flaked, not the behaviour. 800 messages keep the "long thread" meaning, and the
  // case gets its own budget so a slow machine cannot turn it red.
  it('rolls the bar back when the engine never confirms the decision', async () => {
    vi.useRealTimers()
    const { host } = mountPage(longConversationWithApproval(800))
    await nextTick()
    await nextTick()

    host.querySelector<HTMLButtonElement>('[data-testid="approval-bar-allow"]')?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="approval-bar-submitting"]')).not.toBeNull()

    await new Promise(resolve => setTimeout(resolve, 3400))
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
  }, 15000)
})

describe("ChatPage approval bar and asks", () => {
  // An ask shares the approval channel but is a question: Allow/Deny would submit an
  // empty answer as if the user had granted something.
  it("never shows allow or deny for an ask", async () => {
    const conversation = longConversationWithApproval(20)
    conversation.messages.at(-1)!.toolName = "milksu_ask"
    const { host } = mountPage(conversation)
    await nextTick()
    await nextTick()

    expect(host.querySelector('[data-testid="approval-bar"]')).toBeNull()
  })

  it("keeps an ask out of the bar even when a permission is pending too", async () => {
    const conversation = longConversationWithApproval(20)
    const last = conversation.messages.at(-1)!
    last.toolName = "milksu_ask"
    conversation.messages.push({
      id: "approval-2",
      role: "assistant",
      content: "rm -rf /Users/me/work/old",
      timestamp: 99,
      status: "done",
      toolName: "bash",
      approvalRequestId: "approval-2",
      approvalState: "pending",
    })
    const { host } = mountPage(conversation)
    await nextTick()
    await nextTick()

    const bar = host.querySelector('[data-testid="approval-bar"]')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain("bash")
  })
})

describe("ChatPage approval bar gate", () => {
  // The card refuses an unknown target; the bar used to offer Allow anyway, which let
  // the reader grant exactly what the card denied.
  it("offers only deny when the verification refuses", async () => {
    const conversation = longConversationWithApproval(20)
    conversation.messages.at(-1)!.content = "ls /tmp/old | xargs rm -rf"
    const { host } = mountPage(conversation)
    await nextTick()
    await nextTick()

    expect(host.querySelector('[data-testid="approval-bar-gate"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="approval-bar-allow"]')).toBeNull()
    expect(host.querySelector('[data-testid="approval-bar-deny"]')).not.toBeNull()
  })

  it("still offers allow for a scoped delete", async () => {
    const conversation = longConversationWithApproval(20)
    conversation.messages.at(-1)!.content = "rm -rf /Users/me/work/build"
    const { host } = mountPage(conversation)
    await nextTick()
    await nextTick()

    expect(host.querySelector('[data-testid="approval-bar-gate"]')).toBeNull()
    expect(host.querySelector('[data-testid="approval-bar-allow"]')).not.toBeNull()
  })
})

describe("ChatPage engine notice", () => {
  // A refused deletion is a decision with no button, so it must be visible as a status
  // line above the transcript - and absent when the engine said nothing.
  it("shows the status line only when the engine reported one", async () => {
    const quiet = mountPage(longConversationWithApproval(3))
    await nextTick()
    expect(quiet.host.querySelector("[data-testid=\"engine-notice\"]")).toBeNull()

    const noticed = mountPage(longConversationWithApproval(3), {
      engineNotice: "已拦截一条删除命令：目标含变量 —— 未执行。",
      engineNoticeRepeat: 1,
    })
    await nextTick()
    const line = noticed.host.querySelector("[data-testid=\"engine-notice\"]")
    expect(line).not.toBeNull()
    expect(line?.textContent).toContain("已拦截一条删除命令")
    expect(line?.textContent).toContain("未执行")
    expect(noticed.host.querySelector("[data-testid=\"engine-notice-repeat\"]")).toBeNull()
  })

  it("counts a repeated notice instead of adding lines", async () => {
    const { host } = mountPage(longConversationWithApproval(3), {
      engineNotice: "已拦截一条删除命令：目标含变量 —— 未执行。",
      engineNoticeRepeat: 3,
    })
    await nextTick()
    expect(host.querySelectorAll("[data-testid=\"engine-notice\"]").length).toBe(1)
    expect(host.querySelector("[data-testid=\"engine-notice-repeat\"]")?.textContent).toContain("3")
  })
})
