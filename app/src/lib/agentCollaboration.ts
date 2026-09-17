import type { AgentCollaborationConfig } from '@/types'

/**
 * 搬运自本地分支（C）：算出某个对话新的「可访问的对话」名单。
 *
 * 名单是单向的：源对话列出它允许投递到的目标。空名单等于不允许投给任何人，
 * 所以空名单会**删掉那一格**而不是留一个空数组（后端判"查不到=不允许"）。
 * 「同时允许对方回复我」把反向那格一次配好；没有目标时反向那格也一起删掉。
 */
export function withReachableChats(
  previous: AgentCollaborationConfig,
  sourceId: string,
  targetIds: string[],
  allowResultReply = false,
): AgentCollaborationConfig {
  const source = String(sourceId ?? '').trim()
  const allowByConversation: Record<string, string[]> = { ...(previous.allow_by_conversation ?? {}) }
  const replyByConversation: Record<string, string[]> = {
    ...(previous.result_reply_by_conversation ?? {}),
  }
  // 去重、去空白、去掉自己（一个对话不能投给自己）。
  const ids = [...new Set(
    (targetIds ?? []).map(id => String(id ?? '').trim()).filter(id => id && id !== source),
  )]
  if (source && ids.length) allowByConversation[source] = ids
  else delete allowByConversation[source]
  if (source && allowResultReply && ids.length) replyByConversation[source] = ids
  else delete replyByConversation[source]
  return {
    ...previous,
    allow_by_conversation: allowByConversation,
    result_reply_by_conversation: replyByConversation,
  }
}
