// 搬运自本地分支（C）：「可访问的对话」名单的构造规则。
import { describe, expect, it } from 'vitest'
import { withReachableChats } from '@/lib/agentCollaboration'

describe('withReachableChats', () => {
  it('writes a one-way list, trimmed and de-duplicated, never including the source itself', () => {
    const next = withReachableChats({ allow_cross_conversation: true }, 'source', [
      ' target-a ',
      'target-b',
      'target-a',
      'source',
      '   ',
    ])
    expect(next.allow_by_conversation).toEqual({ source: ['target-a', 'target-b'] })
    // 没有勾选"同时允许对方回复我"就不该写反向那格。
    expect(next.result_reply_by_conversation).toEqual({})
  })

  it('deletes the entry when the list becomes empty, so an empty list reaches nobody', () => {
    const previous = {
      allow_cross_conversation: true,
      allow_by_conversation: { source: ['target-a'], other: ['target-a'] },
      result_reply_by_conversation: { source: ['target-a'] },
    }
    const next = withReachableChats(previous, 'source', [])
    expect(next.allow_by_conversation).toEqual({ other: ['target-a'] })
    expect(next.result_reply_by_conversation).toEqual({})
  })

  it('pairs the two directions when the reader asks for replies', () => {
    const next = withReachableChats({ allow_cross_conversation: true }, 'source', ['target-a'], true)
    expect(next.allow_by_conversation).toEqual({ source: ['target-a'] })
    expect(next.result_reply_by_conversation).toEqual({ source: ['target-a'] })
  })

  it('never touches another conversation\'s entry, and leaves the master switch alone', () => {
    const previous = {
      allow_cross_conversation: false,
      allow_by_conversation: { other: ['target-b'] },
    }
    const next = withReachableChats(previous, 'source', ['target-a'])
    expect(next.allow_cross_conversation).toBe(false)
    expect(next.allow_by_conversation).toEqual({ other: ['target-b'], source: ['target-a'] })
    // 原来那份配置不能被就地改写。
    expect(previous.allow_by_conversation).toEqual({ other: ['target-b'] })
  })
})
