// @vitest-environment jsdom

import { createApp, nextTick, reactive, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentExecutionPlan from './AgentExecutionPlan.vue'
import type { Message } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function planMessage(): Message {
  return {
    id: 'plan-1',
    role: 'tool',
    toolName: 'milksu_progress',
    content: [
      '只调查仓库根目录与 README 开头，确认项目定位。',
      '[x] 列出仓库根目录',
      '[>] 读取 README.md 前 40 行',
      '[ ] 用三句话说明仓库用途',
    ].join('\n'),
    timestamp: 1,
    status: 'done',
  }
}

async function mountPlan(running = true) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AgentExecutionPlan, {
    messages: [planMessage()],
    running,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

function userMessage(id = 'user-1'): Message {
  return { id, role: 'user', content: 'go', timestamp: 1, status: 'done' }
}

function nextPlanMessage(): Message {
  return {
    id: 'plan-2',
    role: 'tool',
    toolName: 'milksu_progress',
    content: ['第二轮计划。', '[>] 写回归测试', '[ ] 交付'].join('\n'),
    timestamp: 2,
    status: 'done',
  }
}

async function mountReactivePlan(messages: Message[], running: boolean) {
  const state = reactive({ messages, running })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { AgentExecutionPlan },
    setup: () => ({ state }),
    template: '<AgentExecutionPlan :messages="state.messages" :running="state.running" />',
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, state }
}

describe('AgentExecutionPlan', () => {
  it('stays on one capsule until hover expands the task rows', async () => {
    const host = await mountPlan()
    const root = host.querySelector<HTMLElement>('[data-testid="agent-execution-plan"]')
    expect(root).not.toBeNull()
    expect(root?.textContent).toContain('第 2 / 3 步')
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('false')
    expect(root?.querySelector('.agent-task-ring--active')).not.toBeNull()
    expect(root?.querySelector('.agent-task-row:not(.agent-task-row--child) .agent-task-ring__index')?.textContent?.trim()).toMatch(/^\d{1,2}$/)

    root?.dispatchEvent(new Event('mouseenter'))
    await nextTick()
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('true')
    expect(root?.textContent).toContain('列出仓库根目录')
    expect(root?.textContent).toContain('读取 README.md 前 40 行')
    expect(root?.textContent).toContain('用三句话说明仓库用途')
    expect(root?.querySelector('.agent-task-pill--ok')?.textContent).toContain('已完成')
    const childIndexes = [...root?.querySelectorAll('.agent-task-row--child .agent-task-ring__index') ?? []]
      .map(node => node.textContent?.trim())
    expect(childIndexes.every(value => value && /^\d{1,2}$/.test(value))).toBe(true)

    root?.dispatchEvent(new Event('mouseleave'))
    await new Promise(resolve => setTimeout(resolve, 200))
    await nextTick()
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('false')
  })

  it('does not render lucide spinners or environment-card chrome', async () => {
    const host = await mountPlan()
    expect(host.querySelector('.lucide-loader-circle')).toBeNull()
    expect(host.innerHTML).not.toContain('border-b border-border px-4 py-4')
    expect(host.querySelector('.agent-task-row')).not.toBeNull()
  })

  // A finished plan used to sit on screen until the next milksu_progress replaced
  // it, so a long-running turn left a stale checklist behind.
  it('hides the finished plan shortly after the turn ends', async () => {
    vi.useFakeTimers()
    const { host, state } = await mountReactivePlan([userMessage(), planMessage()], true)
    const planRoot = () => host.querySelector('[data-testid="agent-execution-plan"]')
    expect(planRoot()).not.toBeNull()

    state.running = false
    await nextTick()
    expect(planRoot()).not.toBeNull()

    await vi.advanceTimersByTimeAsync(4_000)
    await nextTick()
    expect(planRoot()).toBeNull()
    vi.useRealTimers()
  })

  it('keeps the plan visible while the turn is still running', async () => {
    vi.useFakeTimers()
    const { host } = await mountReactivePlan([userMessage(), planMessage()], true)
    await vi.advanceTimersByTimeAsync(30_000)
    await nextTick()
    expect(host.querySelector('[data-testid="agent-execution-plan"]')).not.toBeNull()
    vi.useRealTimers()
  })

  // Switching away and back remounts the component; an idle turn must not pop the
  // finished checklist back up.
  it('does not resurrect a finished plan after a remount', async () => {
    const { host } = await mountReactivePlan([userMessage(), planMessage()], false)
    expect(host.querySelector('[data-testid="agent-execution-plan"]')).toBeNull()
  })

  it('drops the previous plan when the next turn has none', async () => {
    const { host, state } = await mountReactivePlan([userMessage('u1'), planMessage()], true)
    expect(host.querySelector('[data-testid="agent-execution-plan"]')).not.toBeNull()

    state.messages = [
      ...state.messages,
      userMessage('u2'),
      { id: 'answer-2', role: 'assistant', content: '好的', timestamp: 3, status: 'done' },
    ]
    await nextTick()
    expect(host.querySelector('[data-testid="agent-execution-plan"]')).toBeNull()
  })

  it('replaces the plan when a newer one arrives in the same turn', async () => {
    const { host, state } = await mountReactivePlan([userMessage('u1'), planMessage()], true)
    state.messages = [...state.messages, nextPlanMessage()]
    await nextTick()
    expect(host.textContent).toContain('写回归测试')
    expect(host.textContent).not.toContain('列出仓库根目录')
  })
})
