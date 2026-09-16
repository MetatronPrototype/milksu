// Pi already persists the session transcript. MilkSU only records which
// conversations were mid-turn so the next launch can reopen the same chat and
// send the existing recovery prompt. In-flight tool calls are not resumed
// mid-execution.
export const UPDATE_RESUME_STATE_STORAGE_KEY = 'milksu.update-resume'

export interface UpdateResumeState {
  version: 1
  conversationIds: string[]
  activeConversationId: string | null
}

export function readUpdateResumeState(
  storage: Storage | null = safeStorage(),
): UpdateResumeState | null {
  if (!storage) return null
  try {
    const value = JSON.parse(storage.getItem(UPDATE_RESUME_STATE_STORAGE_KEY) ?? '') as Partial<UpdateResumeState>
    if (value.version !== 1 || !Array.isArray(value.conversationIds)) return null
    const conversationIds = value.conversationIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (!conversationIds.length) return null
    return {
      version: 1,
      conversationIds,
      activeConversationId: typeof value.activeConversationId === 'string' && value.activeConversationId
        ? value.activeConversationId
        : null,
    }
  } catch {
    return null
  }
}

export function writeUpdateResumeState(
  value: UpdateResumeState,
  storage: Storage | null = safeStorage(),
) {
  if (!storage) return
  if (!value.conversationIds.length) {
    try {
      storage.removeItem(UPDATE_RESUME_STATE_STORAGE_KEY)
    } catch {
      // Ignore storage failures; an empty marker must not linger.
    }
    return
  }
  try {
    storage.setItem(UPDATE_RESUME_STATE_STORAGE_KEY, JSON.stringify({
      version: 1,
      conversationIds: value.conversationIds,
      activeConversationId: value.activeConversationId,
    }))
  } catch {
    // The desktop renderer can run with storage disabled in tests or restricted profiles.
  }
}

export function consumeUpdateResumeState(
  storage: Storage | null = safeStorage(),
): UpdateResumeState | null {
  const value = readUpdateResumeState(storage)
  if (!storage) return value
  try {
    storage.removeItem(UPDATE_RESUME_STATE_STORAGE_KEY)
  } catch {
    // Ignore storage failures; the next launch would retry the same marker.
  }
  return value
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}
