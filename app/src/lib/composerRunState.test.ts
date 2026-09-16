import { describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import {
  STALE_PARENT_RUN_MS,
  composerAllowsFollowupSend,
  composerParentTurnActive,
  composerRunPhase,
  composerShowsStop,
  parentHasActiveTurnResidue,
  parentHasBlockingToolResidue,
  shouldClearParentRun,
} from '@/lib/composerRunState'

function message(partial: Partial<Message>): Message {
  return {
    id: partial.id ?? 'm',
    role: partial.role ?? 'assistant',
    content: partial.content ?? '',
    timestamp: 1,
    status: partial.status,
    toolName: partial.toolName,
    approvalRequestId: partial.approvalRequestId,
  }
}

describe('composer run state', () => {
  it('treats DSH subagent tool rows as Working, not parent residue', () => {
    expect(parentHasActiveTurnResidue([
      message({ role: 'tool', status: 'running', toolName: 'subagent' }),
    ], 'dsh')).toBe(false)
    expect(parentHasActiveTurnResidue([
      message({ role: 'tool', status: 'running', toolName: 'subagent' }),
    ], 'pi')).toBe(true)
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: '...' }),
    ], 'dsh')).toBe(true)
    expect(parentHasBlockingToolResidue([
      message({ role: 'tool', status: 'running', toolName: 'bash' }),
    ], 'dsh')).toBe(true)
  })

  it('does not treat a DSH assistant waiting on live Working as parent residue', () => {
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: 'delegating' }),
      message({ role: 'tool', status: 'running', toolName: 'subagent' }),
    ], 'dsh', { liveWorkingCount: 2 })).toBe(false)
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: 'delegating' }),
    ], 'dsh', { workingJustEmptied: true })).toBe(false)
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: 'delegating' }),
      message({ role: 'tool', status: 'running', toolName: 'bash' }),
    ], 'dsh', { liveWorkingCount: 1 })).toBe(true)
  })

  it('keeps a just-started parent turn even before the first token', () => {
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 200,
    })).toBe(false)
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 200,
    })).toBe('parent')
  })

  it('clears a stale parent run after subagents finish and the parent has no residue', () => {
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      workingJustEmptied: true,
      msSinceRunStart: 80,
    })).toBe(true)
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: STALE_PARENT_RUN_MS,
    })).toBe(true)
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: true,
      workingJustEmptied: true,
      msSinceRunStart: 80,
    })).toBe(false)
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: STALE_PARENT_RUN_MS,
    })).toBe('idle')
    expect(composerShowsStop('idle')).toBe(false)
    expect(composerAllowsFollowupSend('idle')).toBe(true)
  })

  it('does not show the composer stop while only DSH background Working is live', () => {
    const phase = composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 3,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 8_000,
    })
    expect(phase).toBe('working')
    expect(composerShowsStop(phase)).toBe(false)
    expect(composerAllowsFollowupSend(phase)).toBe(true)
    expect(composerParentTurnActive(phase)).toBe(false)
  })

  it('keeps Stop while the parent is still streaming or running bash', () => {
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: true,
      msSinceRunStart: 8_000,
    })).toBe('parent')
    expect(composerShowsStop('parent')).toBe(true)
    expect(composerAllowsFollowupSend('parent')).toBe(false)
  })

  it('keeps Pi blocked on the parent stop while its subagent tool is running', () => {
    const phase = composerRunPhase({
      kernel: 'pi',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 2,
      parentHasActiveTurnResidue: true,
      msSinceRunStart: 8_000,
    })
    expect(phase).toBe('parent')
    expect(composerShowsStop(phase)).toBe(true)
    expect(composerParentTurnActive(phase)).toBe(true)
  })

  it('keeps stop during compact and abort', () => {
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: true,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
    })).toBe('compacting')
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: true,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
    })).toBe('aborting')
    expect(composerShowsStop('compacting')).toBe(true)
    expect(composerShowsStop('aborting')).toBe(true)
    expect(composerAllowsFollowupSend('compacting')).toBe(false)
    expect(composerAllowsFollowupSend('aborting')).toBe(false)
  })

  it('keeps Multitask children in the Working phase with Send, not Stop', () => {
    const phase = composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: false,
      aborting: false,
      compacting: false,
      liveWorkingCount: 1,
      parentHasActiveTurnResidue: false,
    })
    expect(phase).toBe('working')
    expect(composerShowsStop(phase)).toBe(false)
    expect(composerAllowsFollowupSend(phase)).toBe(true)
  })
})
