import { describe, expect, it } from 'vitest'
import {
  commandsUnavailableCopy,
  dshPlanCopy,
  dshSlashDecision,
  isBackgroundDshJob,
  parseComposerSlash,
  piPlanCopy,
  unknownSlashCopy,
} from './dshHostSurface'

const t = (zh: string, en: string) => zh

describe('dsh host surface', () => {
  it('lists official slash as host execute, not a prompt', () => {
    expect(parseComposerSlash('/plan')).toEqual({ name: 'plan', rawInput: '', line: '/plan' })
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/plan',
      catalog: [{ name: 'plan', description: 'Enter or leave plan mode' }],
    })).toEqual({ kind: 'host', name: 'plan', line: '/plan' })
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/goal ship the dock',
      catalog: [{ name: 'goal' }],
    })).toEqual({ kind: 'host', name: 'goal', line: '/goal ship the dock' })
  })

  it('rejects unknown DSH slash instead of prompting', () => {
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/not-real',
      catalog: [{ name: 'plan' }],
    })).toEqual({ kind: 'reject', name: 'not-real' })
    expect(unknownSlashCopy(t, 'not-real')).toBe('未知命令：/not-real')
  })

  it('routes /compact to the existing compact path', () => {
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/compact',
      catalog: [{ name: 'compact' }],
    })).toEqual({ kind: 'compact', line: '/compact' })
  })

  it('keeps Pi executionMode plan copy write-protect-only on Pi', () => {
    expect(piPlanCopy(t, false).description).toContain('不修改文件')
    expect(dshPlanCopy(t, false).description).not.toContain('不修改文件')
    expect(dshPlanCopy(t, false).description).toContain('不是禁止改文件')
  })

  it('fails listing visibly and leaves Pi slash as a prompt', () => {
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/plan',
      listingFailed: true,
    })).toEqual({ kind: 'unavailable' })
    expect(commandsUnavailableCopy(t)).toBe('命令列表不可用。')
    expect(dshSlashDecision({ kernel: 'pi', line: '/plan' })).toEqual({ kind: 'prompt' })
  })

  it('treats official /plan and /goal as host before the catalog arrives', () => {
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/plan',
    })).toEqual({ kind: 'host', name: 'plan', line: '/plan' })
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/goal ship the dock',
    })).toEqual({ kind: 'host', name: 'goal', line: '/goal ship the dock' })
  })

  it('keeps product-only slash on the existing composer path', () => {
    expect(dshSlashDecision({
      kernel: 'dsh',
      line: '/understand',
      catalog: [],
    })).toEqual({ kind: 'product', name: 'understand' })
  })

  it('projects non-subagent jobs into Working', () => {
    expect(isBackgroundDshJob({ kind: 'bash', status: 'running' })).toBe(true)
    expect(isBackgroundDshJob({ kind: 'subagent', status: 'running' })).toBe(false)
    expect(isBackgroundDshJob({ kind: 'bash', status: 'completed' })).toBe(false)
  })
})
