import { describe, expect, it } from 'vitest'
import {
  settleConsumedQueuedMessages,
  settleQueuedMessagesWhenQueueKnown,
} from '@/lib/queuedGuidanceStatus'

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

// 补触发点（重启后 / 打开会话时也要对账），但必须带安全门 —— 这四条就是门禁。
describe('settling on load needs a trustworthy queue', () => {
  const queued = (content: string) => ({ role: 'user', status: 'queued', content })

  // ③（先写它，因为它定义了"安全"）：队列**没同步过** ⇒ 不知道引擎那边还排没排 ⇒ **一律不转正**。
  //   否则会把"其实还在引擎队列、只是没同步"的消息误判成已消费 ⇒ 转成历史后回声回来 ⇒ 重复。
  it('does not settle anything before the queue is known', () => {
    const messages = [queued('可能还在引擎队列里')]
    expect(settleQueuedMessagesWhenQueueKnown(messages, [], false)).toBe(messages)
    expect(settleQueuedMessagesWhenQueueKnown(messages, undefined, false)).toBe(messages)
  })

  // ② 队列已同步过、且该条不在队列里 ⇒ 确认已消费 ⇒ 转成正常历史消息。
  it('settles once the queue is known and no longer holds the text', () => {
    const settled = settleQueuedMessagesWhenQueueKnown([queued('已被消费')], [], true)
    expect(settled?.[0]?.status).toBe('done')
  })

  // ① 重启后打开会话：本地队列空、队列**已知**（同步过）⇒ 那些卡住的应当自动出现（不再永远 queued）。
  it('settles the messages that were stuck across a restart, once the queue is known', () => {
    const stuck = [queued('我怀疑对话在调取工具…'), queued('我刚才正常排队…'), queued('第三条')]
    const settled = settleQueuedMessagesWhenQueueKnown(stuck, [], true)
    expect(settled?.map(message => message.status)).toEqual(['done', 'done', 'done'])
  })

  // ④ 幂等：没有变化时**返回原数组身份**（不触发多余重渲染）。
  it('is idempotent and keeps the array identity when nothing changes', () => {
    const stillQueued = [queued('还在排')]
    expect(settleQueuedMessagesWhenQueueKnown(stillQueued, ['还在排'], true)).toBe(stillQueued)
    const alreadyDone = [{ role: 'user', status: 'done', content: 'x' }]
    expect(settleQueuedMessagesWhenQueueKnown(alreadyDone, [], true)).toBe(alreadyDone)
    // 队列未知时同样保持身份
    expect(settleQueuedMessagesWhenQueueKnown(stillQueued, [], false)).toBe(stillQueued)
  })
})
