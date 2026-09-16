import { t } from '@/lib/uiLocale'
import { SETTINGS_SIDEBAR_ITEMS, type NormalizedSettingsCategory } from '@/lib/settingsNavigation'
import { formatRelativeAge } from '@/lib/relativeAge'
import { conversationActivityAt } from '@/lib/workspaceSessionRouting'
import type { Conversation } from '@/types'

export const COMMAND_PANEL_SLASH_EVENT = 'milksu:command-panel-slash'
export const COMMAND_PANEL_RECENT_LIMIT = 8

export type CommandPanelFilter = 'all' | 'conversation' | 'settings' | 'slash'

export type CommandPanelItem =
  | { kind: 'conversation'; id: string; title: string; subtitle: string; activityAt: number }
  | { kind: 'settings'; category: NormalizedSettingsCategory; title: string }
  | { kind: 'slash'; id: string; title: string; subtitle: string }

export const COMMAND_SLASH_ITEMS = [
  { id: 'new', keywords: ['clear', '新建'] },
  { id: 'compact', keywords: ['context', '上下文', 'summarize'] },
  { id: 'rewind', keywords: ['undo', '回退', 'rewind'] },
  { id: 'handoff', keywords: ['fork', '接力', 'handoff'] },
  { id: 'model', keywords: ['provider', '模型'] },
  { id: 'permissions', keywords: ['approve', 'approval', '权限'] },
  { id: 'diff', keywords: ['changes', '变更'] },
  { id: 'mcp', keywords: ['tools', '工具'] },
] as const

const ACCENT_COLORS = [
  '#5b9fff',
  '#34d399',
  '#f59e0b',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
]

export function commandSlashLabel(id: (typeof COMMAND_SLASH_ITEMS)[number]['id']) {
  if (id === 'new') return t('新任务', 'New task')
  if (id === 'compact') return t('整理上下文', 'Compact context')
  if (id === 'rewind') return t('丢掉探索', 'Rewind')
  if (id === 'handoff') return t('接到新会话', 'Handoff')
  if (id === 'model') return t('模型', 'Model')
  if (id === 'permissions') return t('权限', 'Permissions')
  if (id === 'diff') return t('变更', 'Changes')
  return 'MCP'
}

export function commandSlashDescription(id: (typeof COMMAND_SLASH_ITEMS)[number]['id']) {
  if (id === 'new') return t('开始一个新的编码会话', 'Start a new coding session')
  if (id === 'compact') return t('整理当前会话上下文', 'Compact the current conversation context')
  if (id === 'rewind') return t('丢掉最近一段探索，留在同一会话', 'Drop the latest exploration and stay in this chat')
  if (id === 'handoff') return t('整理后开新会话继续同一任务', 'Compact, then continue the same task in a new chat')
  if (id === 'model') return t('打开当前任务的模型选择', 'Open the model picker for this task')
  if (id === 'permissions') return t('打开审批与访问范围选择', 'Open approval and access-scope options')
  if (id === 'diff') return t('查看当前工作区的文件改动', 'View file changes in the current workspace')
  return t('查看或接入当前项目的 MCP 服务', 'View or attach MCP servers for this project')
}

function workspaceSubtitle(path?: string | null) {
  const normalized = path?.trim().replaceAll('\\', '/') ?? ''
  if (!normalized) return ''
  return normalized.split('/').filter(Boolean).at(-1) ?? ''
}

export function commandPanelAccent(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return ACCENT_COLORS[hash % ACCENT_COLORS.length]
}

export function formatCommandPanelAge(at: number, now = Date.now()) {
  return formatRelativeAge(at, now)
}

export function commandPanelItems(conversations: Conversation[]): CommandPanelItem[] {
  const chats: CommandPanelItem[] = conversations
    .map(conversation => ({
      kind: 'conversation' as const,
      id: conversation.id,
      title: conversation.title,
      subtitle: workspaceSubtitle(conversation.workspacePath),
      activityAt: conversationActivityAt(conversation),
    }))
    .sort((left, right) => right.activityAt - left.activityAt || left.title.localeCompare(right.title))
  const settings: CommandPanelItem[] = SETTINGS_SIDEBAR_ITEMS.map(item => ({
    kind: 'settings',
    category: item.value,
    title: item.label(),
  }))
  const slash: CommandPanelItem[] = COMMAND_SLASH_ITEMS.map(item => ({
    kind: 'slash',
    id: item.id,
    title: `/${item.id} ${commandSlashLabel(item.id)}`,
    subtitle: commandSlashDescription(item.id),
  }))
  return [...chats, ...settings, ...slash]
}

export function commandItemHaystack(item: CommandPanelItem) {
  if (item.kind === 'conversation') return `${item.title} ${item.subtitle}`
  if (item.kind === 'settings') return `${item.title} ${item.category}`
  const extra = COMMAND_SLASH_ITEMS.find(slash => slash.id === item.id)
  return `${item.title} ${item.subtitle} ${extra?.keywords.join(' ') ?? ''}`
}

export function filterCommandPanelItems(items: CommandPanelItem[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return items
  return items.filter(item => commandItemHaystack(item).toLocaleLowerCase().includes(normalized))
}

export function visibleCommandPanelItems(
  items: CommandPanelItem[],
  query: string,
  filter: CommandPanelFilter,
) {
  const matched = filterCommandPanelItems(items, query)
  const scoped = filter === 'all' ? matched : matched.filter(item => item.kind === filter)
  if (query.trim()) return scoped
  if (filter === 'all' || filter === 'conversation') {
    return scoped.filter(item => item.kind === 'conversation').slice(0, COMMAND_PANEL_RECENT_LIMIT)
  }
  return scoped
}

export function dispatchCommandPanelSlash(id: string) {
  window.dispatchEvent(new CustomEvent(COMMAND_PANEL_SLASH_EVENT, { detail: id }))
}
