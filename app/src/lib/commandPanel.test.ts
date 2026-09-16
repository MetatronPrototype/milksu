import { describe, expect, it } from 'vitest'
import {
  COMMAND_PANEL_RECENT_LIMIT,
  commandPanelItems,
  filterCommandPanelItems,
  formatCommandPanelAge,
  visibleCommandPanelItems,
} from '@/lib/commandPanel'
import type { Conversation } from '@/types'

function conversation(partial: Partial<Conversation> & { id: string; title: string }): Conversation {
  return {
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    ...partial,
  } as Conversation
}

describe('command panel search', () => {
  const items = commandPanelItems([
    conversation({
      id: 'c1',
      title: '修复登录',
      workspacePath: '/docs/MilkSU/Coding/auth',
      createdAt: 30,
    }),
    conversation({ id: 'c2', title: 'Lab replay', workspacePath: '', createdAt: 10 }),
  ])

  it('lists conversations, settings categories, and cheap slash commands', () => {
    expect(items.some(item => item.kind === 'conversation' && item.id === 'c1')).toBe(true)
    expect(items.some(item => item.kind === 'settings' && item.category === 'apikeys')).toBe(true)
    expect(items.some(item => item.kind === 'slash' && item.id === 'compact')).toBe(true)
  })

  it('sorts conversations by latest activity and keeps the workspace name', () => {
    const chats = items.filter(item => item.kind === 'conversation')
    expect(chats.map(item => item.id)).toEqual(['c1', 'c2'])
    expect(chats[0]).toMatchObject({ subtitle: 'auth', activityAt: 30 })
  })

  it('filters by conversation title or folder name', () => {
    const byTitle = filterCommandPanelItems(items, '登录')
    expect(byTitle).toEqual([
      expect.objectContaining({ kind: 'conversation', id: 'c1' }),
    ])
    const byFolder = filterCommandPanelItems(items, 'auth')
    expect(byFolder.some(item => item.kind === 'conversation' && item.id === 'c1')).toBe(true)
  })

  it('filters settings and slash without inventing extra ranks', () => {
    expect(filterCommandPanelItems(items, 'mcp').some(item => (
      item.kind === 'settings' && item.category === 'mcp'
    ))).toBe(true)
    expect(filterCommandPanelItems(items, '整理').some(item => (
      item.kind === 'slash' && item.id === 'compact'
    ))).toBe(true)
  })

  it('returns the full list when the query is blank', () => {
    expect(filterCommandPanelItems(items, '   ')).toEqual(items)
  })

  it('shows only recent chats on the empty All / Chats filters', () => {
    const many = commandPanelItems(
      Array.from({ length: COMMAND_PANEL_RECENT_LIMIT + 3 }, (_, index) => (
        conversation({
          id: `c${index}`,
          title: `任务 ${index}`,
          createdAt: index,
        })
      )),
    )
    const recent = visibleCommandPanelItems(many, '', 'all')
    expect(recent.every(item => item.kind === 'conversation')).toBe(true)
    expect(recent).toHaveLength(COMMAND_PANEL_RECENT_LIMIT)
    expect(visibleCommandPanelItems(many, '', 'settings').every(item => item.kind === 'settings')).toBe(true)
    expect(visibleCommandPanelItems(many, 'mcp', 'all').some(item => item.kind === 'settings')).toBe(true)
    expect(visibleCommandPanelItems(many, 'mcp', 'conversation')).toEqual([])
  })

  it('formats relative ages the way the panel prints them', () => {
    const now = Date.UTC(2026, 8, 16)
    expect(formatCommandPanelAge(now - 10_000, now)).toBe('刚刚')
    expect(formatCommandPanelAge(now - 3 * 60_000, now)).toBe('3m')
    expect(formatCommandPanelAge(now - 15 * 60 * 60_000, now)).toBe('15h')
    expect(formatCommandPanelAge(now - 2 * 24 * 60 * 60_000, now)).toBe('2d')
    expect(formatCommandPanelAge(now - 12 * 24 * 60 * 60_000, now)).toBe('12d')
  })
})
