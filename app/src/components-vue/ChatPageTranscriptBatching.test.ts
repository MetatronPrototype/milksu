// @vitest-environment jsdom

import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatPage from './ChatPage.vue'
import type { Conversation } from '@/types'

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

function longConversation(messageCount: number): Conversation {
  return {
    id: 'conversation-long',
    title: 'long',
    createdAt: 1,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `第 ${index} 条`,
      timestamp: index,
      status: 'done',
    })),
  }
}

function mountPage(initial: Conversation) {
  const active = ref<Conversation>(initial)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { ChatPage },
    setup: () => ({ active, running: false }),
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
    />`,
  })
  app.mount(host)
  mountedApps.push(app)
  return { host, active }
}

function mountedBlockCount(host: HTMLElement) {
  return host.querySelectorAll('.agent-thread > *').length
}

describe('ChatPage transcript batching', () => {
  // Mounting every block of a 3k-message conversation in one task is what froze the
  // renderer, so the first paint must only carry the newest slice.
  it('mounts only the newest slice on the first paint', async () => {
    vi.useFakeTimers()
    const { host } = mountPage(longConversation(400))
    await nextTick()
    await nextTick()
    const count = mountedBlockCount(host)
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(62)
    expect(count).toBeLessThan(200)
  })

  it('fills the earlier blocks on later frames without unloading the tail', async () => {
    vi.useFakeTimers()
    const { host } = mountPage(longConversation(400))
    await nextTick()
    await nextTick()
    const first = mountedBlockCount(host)

    await vi.advanceTimersByTimeAsync(200)
    await nextTick()
    await nextTick()
    const second = mountedBlockCount(host)
    expect(second).toBeGreaterThan(first)

    // The newest message stays mounted throughout: the window grows from the tail.
    expect(host.textContent).toContain('第 399 条')
  })
})
