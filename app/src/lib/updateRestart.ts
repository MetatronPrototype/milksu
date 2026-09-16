export function planUpdateRestart(input: {
  runningConversationIds: readonly string[]
  restartDeferred: boolean
}): 'install' | 'confirm' | 'stay' {
  if (input.restartDeferred) return 'stay'
  if (input.runningConversationIds.length > 0) return 'confirm'
  return 'install'
}

export function selectUpdateResumeConversation(input: {
  conversationIds: readonly string[]
  activeConversationId: string | null
}): string | null {
  if (input.activeConversationId && input.conversationIds.includes(input.activeConversationId)) {
    return input.activeConversationId
  }
  return input.conversationIds[0] ?? null
}

export function updateControlVisible(state: string | undefined): boolean {
  return state === 'available' || state === 'downloading' || state === 'downloaded' || state === 'error'
}
