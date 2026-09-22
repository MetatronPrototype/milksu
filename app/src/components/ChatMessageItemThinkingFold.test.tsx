// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatMessageItem from '@/components/ChatMessageItem'
import type { Message } from '@/types'

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async () => null),
  listenEvent: vi.fn(async () => () => undefined),
}))

const mountedRoots: Root[] = []

function thinkingMessage(): Message {
  return {
    id: 'a1',
    role: 'assistant',
    content: '结论',
    thinking: '第一段思考\n第二段思考',
    thinkingStatus: 'done',
    status: 'done',
    timestamp: 1,
  } as Message
}

async function flush() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderItem(props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<ChatMessageItem message={thinkingMessage()} {...props} />)
  })
  await flush()
  return host
}

beforeEach(async () => {
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale('zh')
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

// 本机偏好（故意不上游）：思考段**默认收起**，连"刚结束的那一段"也收起 ——
// 以前是"最新一段自动展开"，每轮思考一完就撑开一次，观感就是页面一直在跳。
describe('thinking fold default', () => {
  it('renders the thinking rows collapsed by default', async () => {
    const host = await renderItem()
    const more = host.querySelector('.agent-think__more')
    expect(more).toBeTruthy()
    expect(more?.getAttribute('data-open')).toBe('false')
    expect(more?.getAttribute('aria-hidden')).toBe('true')
  })

  it('still opens when the reader clicks it', async () => {
    const host = await renderItem()
    const toggle = host.querySelector('.agent-think button, button[aria-expanded]')
    expect(toggle).toBeTruthy()
    await act(async () => { (toggle as HTMLElement).click() })
    await flush()
    expect(host.querySelector('.agent-think__more')?.getAttribute('data-open')).toBe('true')
  })

  // 显式传 true 的老行为仍然可用（组件本身没被写死）。
  it('honours an explicit open request', async () => {
    const host = await renderItem({ thinkingDefaultOpen: true })
    expect(host.querySelector('.agent-think__more')?.getAttribute('data-open')).toBe('true')
  })
})
