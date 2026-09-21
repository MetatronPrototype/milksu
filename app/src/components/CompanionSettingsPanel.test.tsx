// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CompanionSettingsPanel from '@/components/CompanionSettingsPanel'
import { withAppSettingsDefaults, type AppSettings } from '@/types'

const mountedRoots: Root[] = []
const calls: { method: string; args: Record<string, unknown> | undefined }[] = []

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (method: string, args?: Record<string, unknown>) => {
    calls.push({ method, args })
    if (method === 'get_companion_shell_status') return { wayland: false, float: true }
    if (method === 'list_companion_skins') return { skins: [] }
    if (method === 'set_companion_float_enabled') return { wayland: false, float: args?.enabled === true }
    return null
  }),
}))

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return withAppSettingsDefaults({ ...overrides } as AppSettings)
}

async function flush() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPanel(value: AppSettings) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<CompanionSettingsPanel settings={value} groups={[]} onPersist={() => undefined} />)
  })
  await flush()
  await flush()
  return host
}

function switchByLabel(label: string) {
  return [...document.querySelectorAll('button[role="switch"], [role="switch"]')]
    .find(node => (node.getAttribute('aria-label') ?? '').includes(label))
}

beforeEach(async () => {
  calls.length = 0
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale('zh')
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('CompanionSettingsPanel', () => {
  // 用户要的是一个**看得懂**的开关：桌宠显示与否，就在桌宠设置里。
  it('shows a 显示桌宠 switch that reflects the stored setting', async () => {
    await renderPanel(settings({ companion_float_enabled: true }))
    const toggle = switchByLabel('显示桌宠')
    expect(toggle).toBeTruthy()
    expect(toggle?.getAttribute('aria-checked')).toBe('true')

    await renderPanel(settings({ companion_float_enabled: false }))
    const off = [...document.querySelectorAll('[role="switch"]')]
      .filter(node => (node.getAttribute('aria-label') ?? '').includes('显示桌宠'))
    expect(off.some(node => node.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('asks the desktop shell to hide the companion when switched off', async () => {
    const host = await renderPanel(settings({ companion_float_enabled: true }))
    const toggle = [...host.querySelectorAll('[role="switch"]')]
      .find(node => (node.getAttribute('aria-label') ?? '').includes('显示桌宠'))
    expect(toggle).toBeTruthy()
    await act(async () => { (toggle as HTMLElement).click() })
    await flush()
    const call = calls.find(entry => entry.method === 'set_companion_float_enabled')
    expect(call?.args?.enabled).toBe(false)
  })
})
