// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import qrcode from 'qrcode-generator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/components/SettingsPage'
import { SETTINGS_SIDEBAR_ITEMS } from '@/lib/settingsNavigation'
import {
  withAppSettingsDefaults,
  type AppSettings,
  type RemoteAuditEntry,
  type RemoteControlStatus,
} from '@/types'

const phoneAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'

const mountedRoots: Root[] = []
const calls: { method: string; args: unknown[] }[] = []

function flush() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function settingsPayload(allowDangerousTools = false): AppSettings {
  return withAppSettingsDefaults({
    remote_control: { enabled: true, bind_mode: 'lan', port: 58993, allow_dangerous_tools: allowDangerousTools },
  } as AppSettings)
}

function statusPayload(overrides: Partial<RemoteControlStatus> = {}): RemoteControlStatus {
  return {
    enabled: true,
    running: true,
    bind_mode: 'lan',
    port: 58993,
    url: 'http://192.168.0.126:58993',
    pairing_code: 'AB12CD34EF',
    session_ttl_hours: 168,
    devices: [
      {
        id: 'device-1',
        name: phoneAgent,
        ip: '192.168.0.44',
        networks: ['192.168.0.0/24'],
        capability: 'control',
        state: 'active',
        expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        first_seen_at: '2026-09-12T19:00:00Z',
        last_seen_at: '2026-09-14T16:08:00Z',
        can_control: true,
      },
    ],
    ...overrides,
  }
}

function auditPayload(): RemoteAuditEntry[] {
  return [
    {
      at: '2026-09-14 16:08',
      device_id: 'device-1',
      device_name: 'iPhone',
      ip: '192.168.0.44',
      action: 'pair',
      detail: '重新配对：复用原设备，保留已有权限',
      ok: true,
    },
    {
      at: '2026-09-14 16:09',
      device_id: 'device-1',
      device_name: 'iPhone',
      ip: '192.168.0.44',
      action: 'send',
      ok: false,
      error: '该设备为只读权限',
    },
  ]
}

type AppFixture = Record<string, (...args: unknown[]) => unknown>

// The desktop bridge is looked up per call, so unknown methods reject instead of
// silently resolving; every call is recorded for the assertions below.
function appFixture(overrides: AppFixture = {}): AppFixture {
  const handlers: AppFixture = {
    GetSettings: () => settingsPayload(),
    GetRemoteControlStatus: () => statusPayload(),
    GetRemoteAudit: () => auditPayload(),
    IssueRemotePairingCode: (deviceId: unknown) => statusPayload({ pairing_device_id: String(deviceId ?? '') }),
    SetRemoteDangerousTools: () => undefined,
    ...overrides,
  }
  return new Proxy(handlers, {
    get(target, prop: string) {
      const handler = target[prop]
      if (typeof handler !== 'function') {
        return async () => {
          throw new Error(`unsupported desktop test method: ${prop}`)
        }
      }
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return handler(...args)
      }
    },
  })
}

async function renderSettings(fixture: AppFixture = appFixture(), settings: AppSettings = settingsPayload()) {
  ;(window as unknown as { go: unknown }).go = { main: { App: fixture } }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<SettingsPage settings={settings} initialCategory="network" resolvedTheme="dark" />)
  })
  await flush()
  await flush()
  return host
}

function findButton(label: string) {
  return [...document.querySelectorAll('button')].find(button => (button.textContent ?? '').includes(label))
}

function remoteCalls(method: string) {
  return calls.filter(call => call.method === method)
}

beforeEach(() => {
  calls.length = 0
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('SettingsPage remote control panel', () => {
  it('lists the network category in the settings navigation', () => {
    expect(SETTINGS_SIDEBAR_ITEMS.map(item => item.value)).toContain('network')
  })

  it('shows the address, the pairing code and a human device label', async () => {
    await renderSettings()
    const text = document.body.textContent ?? ''
    expect(text).toContain('远端控制')
    expect(text).toContain('http://192.168.0.126:58993')
    expect(text).toContain('AB12CD34EF')
    expect(text).toContain('iPhone · Safari')
    expect(text).not.toContain('Mozilla/5.0')
    expect(text).toContain('192.168.0.44')
    expect(text).toContain('192.168.0.0/24')
    expect(text).toContain('还有')
    expect(text).toContain('上次活动')
    expect(remoteCalls('GetRemoteControlStatus').length).toBeGreaterThan(0)
    expect(remoteCalls('GetRemoteAudit')[0]?.args[0]).toBe(40)
  })

  // 二维码里必须是页面读的那个约定：网址 + ?pair=绑定码。用同一个库把期望的字符串
  // 重新编码一遍再比模块图——只断言「有个二维码」是看不出内容写错的。
  it('encodes the address and the pairing code the phone scans', async () => {
    await renderSettings()
    const path = document.querySelector<SVGPathElement>('[data-testid="remote-qr"] path')
    expect(path).not.toBeNull()

    const expected = qrcode(0, 'M')
    expected.addData('http://192.168.0.126:58993/?pair=AB12CD34EF')
    expected.make()
    let modules = ''
    for (let row = 0; row < expected.getModuleCount(); row += 1) {
      for (let column = 0; column < expected.getModuleCount(); column += 1) {
        if (expected.isDark(row, column)) modules += `M${column} ${row}h1v1h-1z`
      }
    }
    expect(path?.getAttribute('d')).toBe(modules)
  })

  it('warns when dangerous actions are open to remote devices', async () => {
    await renderSettings(appFixture(), settingsPayload(true))
    const warning = document.querySelector('[data-testid="remote-danger-warning"]')
    expect(warning).not.toBeNull()
    expect(warning?.textContent ?? '').toContain('危险操作已开给远端')
  })

  it('copies the pairing code and the address with one tap', async () => {
    await renderSettings()
    const writes = (navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } }).mock.calls

    findButton('复制绑定码')?.click()
    await flush()
    findButton('复制网址')?.click()
    await flush()

    const written = writes.map(call => call[0])
    expect(written).toContain('AB12CD34EF')
    expect(written).toContain('http://192.168.0.126:58993')
  })

  // 手机上的动作是「看一眼、点一下」：三个值都要有**放大且可点即复制**的框，
  // 而且必须接在**既有**复制能力上（不是又实现一份 ✗）。
  it('offers the pairing code, the address and the host password as tap-to-copy boxes', async () => {
    await renderSettings(appFixture({
      GetRemoteControlStatus: () => statusPayload({ password: 'LOCALPASS1' }),
    }))
    const writes = (navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } }).mock.calls
    const boxes = ['remote-value-pairing', 'remote-value-address', 'remote-value-password']
      .map(id => document.querySelector<HTMLElement>(`[data-testid="${id}"]`))
    expect(boxes.every(Boolean)).toBe(true)
    for (const box of boxes) expect(box?.textContent ?? '').not.toBe('')

    boxes[0]?.click()
    await flush()
    expect(writes.map(call => call[0])).toContain('AB12CD34EF')
  })

  it('re-pairs the device it was asked for instead of enrolling a new one', async () => {
    await renderSettings()
    findButton('换网重配')?.click()
    await flush()

    const issued = remoteCalls('IssueRemotePairingCode')
    expect(issued.length).toBe(1)
    // 桥接层把 { deviceId } 拆成位置参数往 Go 传，所以这里看的是第一个实参。
    expect(issued[0]?.args[0]).toBe('device-1')
  })

  it('keeps dangerous remote actions off when settings say so, and flips it through its own RPC', async () => {
    await renderSettings()
    const toggle = document.querySelector('[aria-label="允许远端执行危险操作"]') as HTMLElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('data-state')).toBe('unchecked')

    await act(async () => {
      toggle?.click()
    })
    await flush()

    const applied = remoteCalls('SetRemoteDangerousTools')
    expect(applied.length).toBe(1)
    expect(applied[0]?.args[0]).toBe(true)
  })

  it('shows the remote audit trail, including a refused attempt', async () => {
    await renderSettings()
    const text = document.body.textContent ?? ''
    expect(text).toContain('远端操作记录')
    expect(text).toContain('重新配对：复用原设备，保留已有权限')
    expect(text).toContain('该设备为只读权限')
  })
})
