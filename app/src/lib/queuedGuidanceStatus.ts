/**
 * 把"已经不再排队的排队消息"转正。
 *
 * 现场症状：读者插入的排程引导**被引擎消费了**（引擎存档里有这条 user 消息），但 app 里那条消息的
 * `status` 一直是 `'queued'` ⇒ 界面把它当"排队中"而不是历史消息 ⇒ **看起来像被吞了** ✗。
 *
 * 为什么原来的写法会漏：旧逻辑只在"两次回声之间队列**变短**"时才按数量转正，
 * 而"加入对话"会在本地**提前**把该条从队列移除 ⇒ 队列长度不再变化 ⇒ 计数恒为 0 ⇒ 永不转正 ✗。
 *
 * 这里改成**按文本对账**：本会话里 `status === 'queued'` 的消息，只要它的正文**已经不在本地队列里**，
 * 就说明它不再排队了（要么被引擎消费，要么被并入本轮）⇒ 转成正常历史消息。
 * 队列里**还在**的条目不碰；不是 queued 的消息一律不碰（不越权转正）。
 */

type QueuedMessage = {
  role?: string
  status?: string
  content?: unknown
}

export function settleConsumedQueuedMessages<T extends QueuedMessage>(
  messages: T[] | undefined,
  pendingSteering: readonly string[] | undefined,
): T[] {
  if (!Array.isArray(messages) || !messages.length) return messages ?? []
  // 队列里还排着的正文（只看字符串，防御脏数据）。
  const stillPending = new Set(
    (pendingSteering ?? [])
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim()),
  )
  let changed = false
  const settled = messages.map(message => {
    if (!message || message.role !== 'user' || message.status !== 'queued') return message
    const text = typeof message.content === 'string' ? message.content.trim() : ''
    // 正文已经不在队列里 ⇒ 它不再排队（被消费 / 被并入本轮）⇒ 转正，让它作为历史消息显示。
    if (!text || stillPending.has(text)) return message
    changed = true
    return { ...message, status: 'done' as const }
  })
  // 没变化就返回原数组，避免无谓的重渲染（转录里可能有几千条消息）。
  return changed ? settled : messages
}
