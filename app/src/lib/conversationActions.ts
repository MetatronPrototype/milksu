import type { Conversation, Message } from '@/types'

/** Title plus the conversation id. Never include credentials, keys, or local paths. */
export function conversationCopyText(conversation: Pick<Conversation, 'id' | 'title'>): string {
  const title = String(conversation.title ?? '').trim()
  const id = String(conversation.id ?? '').trim()
  return [title, id].filter(Boolean).join('\n')
}

export function assistantForkPoint(messages: Message[]): { index: number, occurrence: number } | null {
  let occurrence = -1
  let index = -1
  for (let cursor = 0; cursor < messages.length; cursor += 1) {
    if (messages[cursor]?.role !== 'assistant') continue
    occurrence += 1
    index = cursor
  }
  if (index < 0 || occurrence < 0) return null
  return { index, occurrence }
}

/**
 * Clone the product conversation row for a sidebar Fork.
 * Pi owns true session-fork (`fork_conversation` from an assistant turn).
 * Without that point, MilkSU only copies workspace / project / home / kernel
 * settings onto a new row — not a second agent harness.
 */
export function cloneConversationForFork(
  source: Conversation,
  options: { id: string, title?: string, messages?: Message[] },
): Conversation {
  const title = String(options.title ?? source.title).trim().slice(0, 40) || source.title
  return {
    ...source,
    id: options.id,
    title,
    createdAt: Date.now(),
    pinned: undefined,
    pinnedOrder: undefined,
    archivedAt: undefined,
    lastContextUsage: undefined,
    subagentTasks: undefined,
    parentConversationId: undefined,
    multitask: undefined,
    messages: (options.messages ?? []).map(item => ({ ...item })),
  }
}
