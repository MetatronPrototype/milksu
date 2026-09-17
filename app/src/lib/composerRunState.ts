import type { AgentKernel } from '@/lib/agentKernel'
import type { Message } from '@/types'

export type ComposerRunPhase = 'idle' | 'parent' | 'working' | 'compacting' | 'aborting'

export const STALE_PARENT_RUN_MS = 2_000
/**
 * pi 的“引擎彻底没声了”兜底。
 *
 * 2 秒那条本来是为 DSH/ACP 写的（一段 assistant 行可能在 Working 空掉后还挂着 running）。
 * 把它套到 pi 上就变成了一个假信号：工具刚结束、模型正在想下一步的那几秒里
 * 没有任何“running 消息”，于是回合被判定结束 → 红停止按钮消失又出现（用户实测的闪），
 * 而且那段缝里发出去的消息会被当成新回合。pi 的回合结束是引擎显式上报的
 * （turn_settled → assistant.settled → finishRun），所以这里只需要一个很长的兜底。
 */
export const STALE_PARENT_RUN_FALLBACK_MS = 5 * 60_000

export function isBackgroundWorkingTool(toolName?: string) {
  const name = String(toolName ?? '').trim().toLowerCase()
  return name === 'subagent' || name.startsWith('subagent:')
}

function isPendingApproval(message: Message) {
  return Boolean(message.approvalRequestId)
}

function isRunningMessage(message: Message) {
  return message.status === 'running' && !isPendingApproval(message)
}

/** Bash / write / streaming tools that still own the parent turn. */
export function parentHasBlockingToolResidue(
  messages: readonly Message[],
  kernel: AgentKernel,
): boolean {
  return messages.some((message) => {
    if (!isRunningMessage(message) || message.role === 'assistant') return false
    if (kernel === 'dsh' && isBackgroundWorkingTool(message.toolName)) return false
    return true
  })
}

/**
 * Parent is still generating text or running a tool that is not a background
 * DSH subagent. A DSH assistant row can stay `running` until ACP `whenIdle`
 * even after Working empties — that is not parent residue.
 */
export function parentHasActiveTurnResidue(
  messages: readonly Message[],
  kernel: AgentKernel,
  extras?: { liveWorkingCount?: number; workingJustEmptied?: boolean },
): boolean {
  if (parentHasBlockingToolResidue(messages, kernel)) return true
  const assistantRunning = messages.some(message => (
    isRunningMessage(message) && message.role === 'assistant'
  ))
  if (!assistantRunning) return false
  if (
    kernel === 'dsh'
    && ((extras?.liveWorkingCount ?? 0) > 0 || extras?.workingJustEmptied === true)
  ) {
    return false
  }
  return true
}

export function shouldClearParentRun(input: {
  kernel: AgentKernel
  parentMarkedRunning: boolean
  compacting: boolean
  aborting: boolean
  liveWorkingCount: number
  parentHasActiveTurnResidue: boolean
  workingJustEmptied?: boolean
  msSinceRunStart: number
}): boolean {
  if (!input.parentMarkedRunning || input.compacting || input.aborting) return false
  if (input.liveWorkingCount > 0) return false
  if (input.parentHasActiveTurnResidue) return false
  if (input.workingJustEmptied) return true
  const threshold = input.kernel === 'dsh' ? STALE_PARENT_RUN_MS : STALE_PARENT_RUN_FALLBACK_MS
  return input.msSinceRunStart >= threshold
}

export function composerRunPhase(input: {
  kernel: AgentKernel
  parentMarkedRunning: boolean
  aborting: boolean
  compacting: boolean
  liveWorkingCount: number
  parentHasActiveTurnResidue: boolean
  msSinceRunStart?: number
}): ComposerRunPhase {
  if (input.compacting) return 'compacting'
  if (input.aborting && input.parentMarkedRunning) return 'aborting'
  if (
    shouldClearParentRun({
      kernel: input.kernel,
      parentMarkedRunning: input.parentMarkedRunning,
      compacting: false,
      aborting: false,
      liveWorkingCount: input.liveWorkingCount,
      parentHasActiveTurnResidue: input.parentHasActiveTurnResidue,
      msSinceRunStart: input.msSinceRunStart ?? 0,
    })
  ) {
    return 'idle'
  }
  if (
    input.kernel === 'dsh'
    && input.liveWorkingCount > 0
    && !input.parentHasActiveTurnResidue
  ) {
    return 'working'
  }
  if (input.parentMarkedRunning || input.parentHasActiveTurnResidue) return 'parent'
  return 'idle'
}

export function composerShowsStop(phase: ComposerRunPhase) {
  return phase === 'parent' || phase === 'compacting' || phase === 'aborting'
}

/** Idle or DSH Working: composer Send is a followup / new turn, not parent Stop. */
export function composerAllowsFollowupSend(phase: ComposerRunPhase) {
  return phase === 'idle' || phase === 'working'
}

export function composerParentTurnActive(phase: ComposerRunPhase) {
  return phase === 'parent' || phase === 'aborting'
}
