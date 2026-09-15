/**
 * Parsing and risk assessment for destructive approval requests.
 *
 * The approval card must show what a delete command actually touches. Agents phrase
 * the same intent in many ways (`rm -rf`, `rm -f file`, `find … -delete`, `… | xargs rm`),
 * and a naive parse used to report the whole workspace root for a `find … -delete`,
 * which scared the user. Everything here is pure so it can be unit tested; the parts
 * that need the filesystem or git (existence, size, tracking) are supplied by the
 * backend as measurements and merged in `describeDestructiveRequest`.
 */

export type DestructiveTargetKind = 'file' | 'directory-tree' | 'glob' | 'unknown'

export interface DestructiveTarget {
  /** The text as written in the command. */
  raw: string
  /** Absolute path, when it can be determined. */
  path?: string
  kind: DestructiveTargetKind
  recursive: boolean
  /** Why this target and kind were chosen - shown to the user. */
  reason: string
}

export interface DestructiveFacts {
  /** Measured by the backend: does the path exist, is it an empty directory. */
  exists?: boolean
  emptyDirectory?: boolean
  /** Measured by the backend: files and bytes under the target. */
  fileCount?: number
  totalBytes?: number
  /** Sampled means the backend stopped early; the numbers are a lower bound. */
  sampled?: boolean
  /** Git facts: inside a repository and whether the target is tracked. */
  inGitRepository?: boolean
  gitTracked?: boolean
  /** A rebuildable source exists (same commit reachable, backup present, ...). */
  rebuildable?: boolean
  rebuildSource?: string
  /** Backups found next to the target. */
  backups?: string[]
}

export interface ProtectedMatch {
  protected: boolean
  /** The rule that matched, for display. */
  rule?: string
}

export interface DestructiveAssessment {
  targets: DestructiveTarget[]
  /** Every matched protection rule across all targets. */
  protections: string[]
  /** True when nothing could be determined: never allow by default. */
  undetermined: boolean
  /** The allow button is gated on this: unknown scope or a protected path. */
  canAllow: boolean
  /** Nothing can bring it back (no git tracking, no backup) - shown in red. */
  irrecoverable: boolean
  /** One-line verdict shown at the bottom of the card. */
  verdict: string
  risk: 'low' | 'medium' | 'high'
  /** True when the user data directories are touched. */
  touchesUserData: boolean
}

const USER_DATA_DIRECTORIES = [
  'runtime-data',
  'Documents',
  'Desktop',
]

const PROTECTED_RULES: { rule: string; test: (path: string) => boolean }[] = [
  { rule: '/private/tmp/mairecord-*', test: p => /^\/private\/tmp\/mairecord-/.test(p) },
  { rule: '/private/tmp/milksu-*', test: p => /^\/private\/tmp\/milksu-/.test(p) },
  { rule: 'DerivedData', test: p => /(^|\/)DerivedData(\/|$)/.test(p) },
  { rule: 'runtime-data', test: p => /(^|\/)runtime-data(\/|$)/.test(p) },
  { rule: '~/Documents', test: p => /(^|\/)Documents(\/|$)/.test(p) },
  { rule: '~/Desktop', test: p => /(^|\/)Desktop(\/|$)/.test(p) },
  // Library is protected except for the caches that are explicitly rebuildable.
  {
    rule: '~/Library',
    test: p => /(^|\/)Library(\/|$)/.test(p)
      && !/(^|\/)Library\/Caches(\/|$)/.test(p)
      && !/(^|\/)Library\/Logs(\/|$)/.test(p),
  },
  { rule: 'maiRecord 记录', test: p => /mairecord/i.test(p) && /(record|trainer)/i.test(p) },
]

/** Split a shell-ish command into simple tokens, honouring quotes. */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote = ''
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = '' }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function isFlag(token: string) {
  return token.startsWith('-')
}

function classify(raw: string, cwd: string): DestructiveTarget {
  if (raw.includes('*') || raw.includes('?')) {
    return { raw, kind: 'glob', recursive: true, reason: '通配表达式，作用范围由实际匹配决定' }
  }
  const path = absolute(raw, cwd)
  return { raw, path, kind: 'directory-tree', recursive: true, reason: '目录及其内容' }
}

function absolute(raw: string, cwd: string): string | undefined {
  if (!raw || raw === '.' || raw === './') return cwd
  if (raw.startsWith('/')) return raw
  if (raw === '~') return process.env.HOME ?? raw
  if (raw.startsWith('~/')) return `${process.env.HOME ?? ''}${raw.slice(1)}`
  if (raw.startsWith('-')) return undefined
  return `${cwd.replace(/\/$/, '')}/${raw.replace(/^\.\//, '')}`
}

/**
 * Split a command on top-level `;`, `&&`, `||` and newlines, ignoring separators that
 * sit inside quotes. Daily commands look like `cd x; rm -rf y; echo done`, and the old
 * parser refused all of them as "undetermined".
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    const pair = text.slice(index, index + 2)
    if (char === ';' || char === '\n') {
      parts.push(current)
      current = ''
      continue
    }
    if (pair === '&&' || pair === '||') {
      parts.push(current)
      current = ''
      index += 1
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(Boolean)
}

/** Command substitutions that may hide a delete: `$(…)` and backticks. */
function substitutions(text: string): string[] {
  const found: string[] = []
  const pattern = /\$\(([^()]*)\)|`([^`]*)`/g
  let match = pattern.exec(text)
  while (match) {
    found.push(match[1] ?? match[2] ?? '')
    match = pattern.exec(text)
  }
  return found
}

/**
 * Work out what a command deletes. Returns an empty list (with an `unknown` target)
 * when the scope cannot be established - callers must treat that as "not allowed".
 */
export function parseDestructiveTargets(command: string, cwd = '/'): DestructiveTarget[] {
  const text = command.trim()
  if (!text) return []
  const segments = splitTopLevel(text)
  const collected: DestructiveTarget[] = []
  let currentCwd = cwd
  for (const segment of segments) {
    // `cd /x ; rm -rf build` deletes /x/build: track the directory change.
    const change = /^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*$/.exec(segment)
    if (change) {
      const raw = change[1] ?? change[2] ?? change[3] ?? ''
      const next = absolute(raw, currentCwd)
      if (next) currentCwd = next
      continue
    }
    collected.push(...parseSingleCommand(segment, currentCwd))
    for (const inner of substitutions(segment)) {
      collected.push(...parseSingleCommand(inner, currentCwd))
    }
  }
  return collected
}

function parseSingleCommand(text: string, cwd: string): DestructiveTarget[] {
  // A delete inside `$(…)` or backticks is handled by the caller; the outer text must
  // not be judged on words that only appear inside that substitution.
  const stripped = text.replace(/\$\([^()]*\)|`[^`]*`/g, ' ')
  const tokens = tokenize(stripped)
  if (!tokens.length) {
    return text === stripped ? [] : []
  }

  // `… | xargs rm` deletes whatever the upstream command produced: not determinable.
  if (/\|\s*xargs\s+rm/.test(text) || /\bxargs\b[^|]*\brm\b/.test(text)) {
    return [{
      raw: text,
      kind: 'unknown',
      recursive: true,
      reason: '目标来自管道输出（xargs），无法从命令本身确定',
    }]
  }

  if (tokens[0] === 'rm') {
    const operands = tokens.slice(1).filter(token => !isFlag(token))
    const recursive = /(^|\s)-[a-z]*r/i.test(stripped)
    if (!operands.length) {
      return [{ raw: text, kind: 'unknown', recursive, reason: '没有可识别的删除目标' }]
    }
    return operands.map(operand => {
      const target = classify(operand, cwd)
      if (target.kind === 'glob') return target
      return recursive
        ? { ...target, reason: '递归删除（-r/-R）' }
        : { ...target, kind: 'file', recursive: false, reason: '单个文件（未递归）' }
    })
  }

  const findIndex = tokens.indexOf('find')
  if (findIndex >= 0 && tokens.includes('-delete')) {
    const root = tokens[findIndex + 1]
    if (!root || isFlag(root)) {
      return [{
        raw: text,
        kind: 'unknown',
        recursive: true,
        reason: 'find 缺少可识别的起始目录',
      }]
    }
    const limited = tokens.some(token => token === '-name' || token === '-size' || token === '!')
    const target = classify(root, cwd)
    if (target.kind === 'glob') return [target]
    return [{
      ...target,
      reason: limited
        ? 'find -delete（带 -name/-size/! 限定，仅匹配项被删）'
        : 'find -delete（整个起始目录树）',
    }]
  }

  if (/\btruncate\b|\b>\s*\S+/.test(text) && !/rm\b/.test(text)) {
    return []
  }

  if (/\b(rm|unlink|shred|rmdir|truncate)\b|\bfind\b[^|]*-delete|\bxargs\b|\bgit\s+clean\b|Remove-Item|(^|\s)del\s/i.test(stripped)) {
    return [{
      raw: text,
      kind: 'unknown',
      recursive: true,
      reason: '无法从命令本身确定删除目标',
    }]
  }
  // Not a delete at all (echo/cd/export/…): nothing to assess.
  return []
}

export function protectedMatch(path: string | undefined): ProtectedMatch {
  if (!path) return { protected: false }
  for (const entry of PROTECTED_RULES) {
    if (entry.test(path)) return { protected: true, rule: entry.rule }
  }
  return { protected: false }
}

export function touchesUserData(path: string | undefined): boolean {
  if (!path) return false
  return USER_DATA_DIRECTORIES.some(directory => (
    new RegExp(`(^|/)${directory}(/|$)`).test(path)
  ))
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Merge the parsed targets with measured facts into what the card shows.
 * `undetermined` is the gate for the "allow" button: no reason, no allow.
 */
export function assessDestructiveRequest(
  command: string,
  facts: DestructiveFacts[] = [],
  cwd = '/',
): DestructiveAssessment {
  const targets = parseDestructiveTargets(command, cwd)
  const protections: string[] = []
  let touchesUserDataFlag = false
  // "Undetermined" only means we saw a delete whose target we cannot pin down. A
  // command with no delete at all is not a destructive request and is not gated here.
  let undetermined = targets.some(target => target.kind === 'unknown')

  targets.forEach((target, index) => {
    const match = protectedMatch(target.path)
    if (match.protected && match.rule) protections.push(match.rule)
    if (touchesUserData(target.path)) touchesUserDataFlag = true
    const fact = facts[index]
    if (target.kind === 'unknown') undetermined = true
    if (fact && fact.gitTracked === false && fact.inGitRepository) {
      // in a repo but untracked: git cannot bring it back
    }
  })

  const untracked = facts.some(fact => fact.inGitRepository && fact.gitTracked === false)
  const rebuildable = facts.some(fact => fact.rebuildable)
  const irrecoverable = !rebuildable && facts.length > 0
  const missing = facts.some((fact, index) => fact.exists === false && targets[index]?.kind !== 'unknown')

  // Risk is informational: it no longer decides whether the reader may allow. Only an
  // unknown target or a protected path is refused outright.
  let risk: DestructiveAssessment['risk'] = 'low'
  if (protections.length || touchesUserDataFlag) risk = 'high'
  else if (untracked && !rebuildable) risk = 'medium'
  else if (undetermined || missing) risk = 'medium'

  const parts: string[] = []
  if (protections.length) parts.push(`命中受保护清单（${protections.join('、')}）`)
  else if (touchesUserDataFlag) parts.push('落在用户数据目录')
  else if (untracked && !rebuildable) parts.push('未跟踪且无备份，无法恢复')
  else if (undetermined) parts.push('目标无法确定')
  else if (missing) parts.push('目标不存在')
  else if (rebuildable) parts.push('可重建，未触及用户数据')
  else parts.push('目标明确，未触及用户数据')

  const size = facts.find(fact => typeof fact.totalBytes === 'number' && typeof fact.fileCount === 'number')
  if (size) {
    parts.push(`${size.fileCount} 个文件 / ${formatBytes(size.totalBytes ?? 0)}${size.sampled ? '（仅采样）' : ''}`)
  }

  return {
    targets,
    protections,
    undetermined,
    // The allow button is gated on this: unknown scope or a protected path, nothing else.
    canAllow: !undetermined && protections.length === 0,
    irrecoverable,
    verdict: `风险：${risk === 'high' ? '高' : risk === 'medium' ? '中' : '低'}（${parts.join('；')}）`,
    risk,
    touchesUserData: touchesUserDataFlag,
  }
}
