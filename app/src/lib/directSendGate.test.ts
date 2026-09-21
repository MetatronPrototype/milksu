import { describe, expect, it } from 'vitest'
import { directSendDecision } from '@/lib/directSendGate'

const base = { running: true, stoppedByUser: false, abnormalEnd: false, uiBehindBackground: false }

describe('direct send gate', () => {
  // ① 正常在跑 ⇒ 直发（今天的现有行为，保持）。
  it('allows a direct send while the turn is genuinely running', () => {
    expect(directSendDecision(base)).toEqual({ allow: true, reason: null, notTrulyRunning: false })
  })

  // ② 手动停止过 ⇒ 不许直发，且要能给出原因（调用方据此提示读者）。
  it('refuses after the reader stopped the turn', () => {
    const decision = directSendDecision({ ...base, stoppedByUser: true })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe('stopped-by-user')
  })

  // ③ 上一轮没正常结束 ⇒ 不许直发。
  it('refuses when the previous turn did not end cleanly', () => {
    const decision = directSendDecision({ ...base, abnormalEnd: true })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe('abnormal-end')
  })

  // ④ 界面显示已结束、后台仍在跑（最危险）⇒ 不许直发。
  it('refuses when the interface says finished while the turn still runs', () => {
    const decision = directSendDecision({ ...base, running: false, uiBehindBackground: true })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toBe('ui-behind-background')
  })

  // 没在跑、也没有异常 ⇒ 也不是"直发进正在跑的回合"（调用方会走排队/新回合），这里如实说清。
  it('is explicit when nothing is running at all', () => {
    const decision = directSendDecision({ running: false, stoppedByUser: false, abnormalEnd: false, uiBehindBackground: false })
    expect(decision.allow).toBe(false)
    expect(decision.notTrulyRunning).toBe(true)
    expect(decision.reason).toBeNull()
  })

  // 同时命中多条时，按"读者最需要知道的"优先：被停过 > 异常收尾 > UI 与真实不一致。
  it('reports the most relevant reason when several apply', () => {
    expect(directSendDecision({ running: true, stoppedByUser: true, abnormalEnd: true, uiBehindBackground: true }).reason)
      .toBe('stopped-by-user')
    expect(directSendDecision({ running: true, stoppedByUser: false, abnormalEnd: true, uiBehindBackground: true }).reason)
      .toBe('abnormal-end')
  })
})
