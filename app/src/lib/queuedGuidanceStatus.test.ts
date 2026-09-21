import { describe, expect, it } from 'vitest'
import { settleConsumedQueuedMessages } from '@/lib/queuedGuidanceStatus'

const queued = (content: string) => ({ role: 'user', status: 'queued', content })

describe('settle consumed queued messages', () => {
  // 现场：这条已经被引擎消费（队列里没有了）⇒ 必须转正，否则界面把它当"排队中"，看起来像被吞了。
  it('turns a queued message into a normal history message once it left the queue', () => {
    const settled = settleConsumedQueuedMessages([queued('测试114514')], [])
    expect(settled[0]?.status).toBe('done')
  })

  // 还在队列里排着的，不许动。
  it('leaves a message that is still queued alone', () => {
    const messages = [queued('还在排')]
    expect(settleConsumedQueuedMessages(messages, ['还在排'])).toBe(messages)
  })

  // 不越权：读者没发过的、非 queued 的、以及别的角色的消息都不许被改。
  it('never touches messages that were not queued user messages', () => {
    const messages = [
      { role: 'assistant', status: 'done', content: 'agent 的话' },
      { role: 'tool', status: 'queued', content: '工具结果' },
      { role: 'user', status: 'done', content: '早就完成的消息' },
      { role: 'user', status: undefined, content: '没有状态的消息' },
    ]
    expect(settleConsumedQueuedMessages(messages, [])).toBe(messages)
  })

  it('trims both sides when matching, and tolerates empty input', () => {
    expect(settleConsumedQueuedMessages([queued('  空白对齐  ')], ['空白对齐'])[0]?.status).toBe('queued')
    expect(settleConsumedQueuedMessages(undefined, [])).toEqual([])
    expect(settleConsumedQueuedMessages([], ['x'])).toEqual([])
  })
})
