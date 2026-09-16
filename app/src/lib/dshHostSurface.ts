import type { AgentKernel } from '@/lib/agentKernel'
import type { DshCommandDescriptor } from '@/types'

export const DSH_PRODUCT_SLASH_IDS = new Set([
  'new',
  'understand',
  'test',
  'review',
  'fix',
  'summary',
  'model',
  'permissions',
  'status',
  'diff',
  'mcp',
  'browser',
  'browser-use',
  'computer-use',
  'rewind',
  'handoff',
])

/** Official DSH commands that exist even before commands.list returns. */
export const DSH_KNOWN_HOST_SLASH_IDS = new Set(['plan', 'goal'])

export function parseComposerSlash(line: string) {
  const raw = String(line ?? '').trim()
  const match = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(raw)
  if (!match) return undefined
  return {
    name: match[1].toLowerCase(),
    rawInput: match[2] ?? '',
    line: `/${match[1].toLowerCase()}${match[2] ? ` ${match[2]}` : ''}`,
  }
}

export function dshSlashDecision(input: {
  kernel?: AgentKernel | string | null
  line: string
  catalog?: readonly DshCommandDescriptor[] | null
  listingFailed?: boolean
}):
  | { kind: 'prompt' }
  | { kind: 'product'; name: string }
  | { kind: 'host'; name: string; line: string }
  | { kind: 'compact'; line: string }
  | { kind: 'reject'; name: string }
  | { kind: 'unavailable' }
{
  if (String(input.kernel ?? '') !== 'dsh') return { kind: 'prompt' }
  const parsed = parseComposerSlash(input.line)
  if (!parsed) return { kind: 'prompt' }
  if (DSH_PRODUCT_SLASH_IDS.has(parsed.name)) return { kind: 'product', name: parsed.name }
  if (input.listingFailed) return { kind: 'unavailable' }
  if (parsed.name === 'compact') return { kind: 'compact', line: parsed.line }
  const catalog = input.catalog
  const names = new Set((catalog ?? []).map(item => item.name))
  if (names.has(parsed.name)) return { kind: 'host', name: parsed.name, line: parsed.line }
  if (!Array.isArray(catalog) && DSH_KNOWN_HOST_SLASH_IDS.has(parsed.name)) {
    return { kind: 'host', name: parsed.name, line: parsed.line }
  }
  return { kind: 'reject', name: parsed.name }
}

export function dshPlanCopy(t: (zh: string, en: string) => string, active: boolean) {
  if (active) {
    return {
      label: t('退出计划', 'Exit plan'),
      description: t('结束计划引导。落实前仍会请你确认。', 'Leave plan guidance. The agent still asks before carrying the plan out.'),
      chip: t('计划', 'Plan'),
      chipTitle: t('计划引导已开启；落实前需确认。点击退出。', 'Plan guidance is on. The agent asks before carrying it out. Click to exit.'),
    }
  }
  return {
    label: t('计划', 'Plan'),
    description: t('进入计划引导。模型先给方案，落实前会请你确认，不是禁止改文件。', 'Enter plan guidance. The agent proposes a plan and asks before carrying it out. This does not block file edits.'),
    chip: t('计划', 'Plan'),
    chipTitle: t('进入计划引导', 'Enter plan guidance'),
  }
}

export function piPlanCopy(t: (zh: string, en: string) => string, active: boolean) {
  if (active) {
    return {
      label: t('退出计划模式', 'Exit plan mode'),
      description: t('恢复使用当前授权工具', 'Resume using currently authorized tools'),
      chip: t('计划', 'Plan'),
      chipTitle: t('只分析和规划，不修改文件；点击退出计划模式', 'Analyze and plan only, without changing files. Click to exit plan mode.'),
    }
  }
  return {
    label: t('计划模式', 'Plan mode'),
    description: t('只分析和规划，不修改文件', 'Analyze and plan only, without changing files'),
    chip: t('计划', 'Plan'),
    chipTitle: t('只分析和规划，不修改文件', 'Analyze and plan only, without changing files'),
  }
}

export function unknownSlashCopy(t: (zh: string, en: string) => string, name: string) {
  return t(`未知命令：/${name}`, `Unknown command: /${name}`)
}

export function commandsUnavailableCopy(t: (zh: string, en: string) => string) {
  return t('命令列表不可用。', 'Command list is unavailable.')
}

export function isBackgroundDshJob(job: { kind?: string; status?: string } | null | undefined) {
  const kind = String(job?.kind ?? '').trim().toLowerCase()
  if (!kind || kind === 'subagent') return false
  const status = String(job?.status ?? '').trim()
  return status === 'running' || status === 'stopping'
}
