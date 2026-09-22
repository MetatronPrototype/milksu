// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceRail from '@/components/WorkspaceRail'
import type { AccountStatus } from '@/types'

const mountedRoots: Root[] = []

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async () => null),
}))

async function flush() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const base = {
  activeSection: 'chat' as const,
  themeMode: 'dark' as const,
}

function account(state: AccountStatus['state'], configured: boolean): AccountStatus {
  return { state, configured, authenticated: state === 'active' }
}

async function renderRail(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<WorkspaceRail {...(props as never)} />)
  })
  await flush()
  return host
}

// 「门铃没接线」护栏（审计实据：Lab 环境预览 `LabEnvironmentPreview.tsx:405` 只传了
// onNavigate / onToggleTheme ⇒ 用户菜单四项永远是 undefined ⇒ 画出来就是「点了没反应」✗）。
describe('workspace rail user menu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    for (const root of mountedRoots) act(() => root.unmount())
    mountedRoots.length = 0
  })

  it('draws no user menu at all when nothing can handle its items', async () => {
    const host = await renderRail({ ...base, accountStatus: account('active', true) })
    // 画出来却点不动，比不画更糟 ⇒ 这里必须什么都不画 ✗
    expect(host.querySelector('.workspace-rail-profile')).toBeNull()
  })

  it('draws only the items that actually have a handler', async () => {
    const onSettings = vi.fn()
    const host = await renderRail({ ...base, accountStatus: account('active', true), onSettings })

    const avatar = host.querySelector('.workspace-rail-profile')
    expect(avatar).not.toBeNull()
    await act(async () => {
      avatar?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    const items = [...host.querySelectorAll('.user-menu-item')].map(node => node.textContent ?? '')
    // 接了活的画 ✓（点了真的会做事的那个）
    expect(items.some(label => label.includes('设置'))).toBe(true)
    // 没接活的不画 ✗（个人资料 / 退出登录都没传）
    expect(items.some(label => label.includes('个人资料'))).toBe(false)
    expect(items.some(label => label.includes('退出登录'))).toBe(false)
  })
})
