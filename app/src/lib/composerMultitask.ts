import { normalizeAgentKernel } from '@/lib/agentKernel'

export function shouldShowMultitaskCapsule(input: {
  kernel?: string | null
  multitask?: boolean | null
}): boolean {
  return normalizeAgentKernel(input.kernel) === 'dsh' && input.multitask === true
}
