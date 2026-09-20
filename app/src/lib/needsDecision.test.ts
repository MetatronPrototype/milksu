import { describe, expect, it } from 'vitest'
import { conversationNeedsDecision, needsDecisionConversationIds } from '@/lib/needsDecision'

const pendingApproval = { approvalState: 'pending', approvalRequestId: 'req-1', toolName: 'bash' }
const pendingAsk = { approvalState: 'pending', approvalRequestId: 'ask-1', toolName: 'milksu_ask' }

describe('needs decision', () => {
  // 会话在等用户批准删除 / 回答 ask 时，必须能被认出来（否则用户不知道轮到自己了）。
  it('notices a pending approval and a pending ask', () => {
    expect(conversationNeedsDecision([pendingApproval])).toBe(true)
    expect(conversationNeedsDecision([pendingAsk])).toBe(true)
  })

  // 已经回答过的（批准/拒绝/过期）都不算"在等我"。
  it('ignores answered and expired requests', () => {
    for (const state of ['approved', 'denied', 'expired']) {
      expect(conversationNeedsDecision([{ ...pendingApproval, approvalState: state }])).toBe(false)
      expect(conversationNeedsDecision([{ ...pendingAsk, approvalState: state }])).toBe(false)
    }
    // 没有请求 id 的 pending 状态不是真的待决策（没有东西可回答）。
    expect(conversationNeedsDecision([{ approvalState: 'pending', toolName: 'bash' }])).toBe(false)
  })

  // 用户可能在待决策后面又插了别的话 ⇒ 不能只看最后一条。
  it('counts an earlier unanswered request even when later messages are settled', () => {
    expect(conversationNeedsDecision([
      pendingApproval,
      { approvalState: 'approved', approvalRequestId: 'req-2', toolName: 'bash' },
    ])).toBe(true)
    // 反过来：最后一条是 pending 也算
    expect(conversationNeedsDecision([
      { approvalState: 'approved', approvalRequestId: 'req-2', toolName: 'bash' },
      pendingAsk,
    ])).toBe(true)
  })

  it('handles empty and missing input', () => {
    expect(conversationNeedsDecision([])).toBe(false)
    expect(conversationNeedsDecision(undefined)).toBe(false)
    expect(needsDecisionConversationIds(undefined)).toEqual([])
  })

  it('lists exactly the conversations that are waiting on the reader', () => {
    const ids = needsDecisionConversationIds([
      { id: 'conv-a', messages: [pendingApproval] },
      { id: 'conv-b', messages: [{ approvalState: 'approved', approvalRequestId: 'x', toolName: 'bash' }] },
      { id: 'conv-c', messages: [pendingAsk] },
      { id: 'conv-d', messages: [] },
    ])
    expect(ids).toEqual(['conv-a', 'conv-c'])
  })
})
