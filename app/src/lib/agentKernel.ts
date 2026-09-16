export type AgentKernel = 'pi' | 'dsh'

export function normalizeAgentKernel(value: unknown): AgentKernel {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'dsh' || raw === 'deepseek' || raw === 'deepseek-harness') return 'dsh'
  return 'pi'
}

export function defaultAgentKernel(value: unknown): AgentKernel {
  return normalizeAgentKernel(value)
}

export function conversationKernelLocked(
  messages: Array<{ role?: string; status?: string | null }> | undefined,
): boolean {
  return (messages ?? []).some(message => (
    message.role === 'user' && message.status !== 'queued'
  ))
}
