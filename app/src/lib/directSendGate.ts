/**
 * "这条消息能不能**直接进入对话**"的判定（产品口径，用户原话 ✓）：
 * 「agent 的"继续干活"可以继续从排程进入对话，但是**手动停止** / **上一轮没正常结束** /
 *   **上一轮只是在后台运行但界面显示已结束**，都不能直接进入对话，必须让用户知情。」
 *
 * 现状（本函数要修的）✗：`send()` 只看 `runningIds.has(id)` ⇒ 只要界面认为"在跑"就直发 ✓；
 * 但"界面认为在跑"与"真的在正常跑"是两件事 ✗ —— 被用户停过、异常收尾、UI 与真实运行态不一致时，
 * 直发会让读者**以为没事**，实际把话插进了一个状态不明的回合 ✗。
 *
 * 本函数只做判定（纯函数 ✓，可测 ✓），不做丢弃 ✗、不做静默处理 ✗：
 * 不允许直发时，调用方**必须**走"排程 + 明确提示"这条路 ✓。
 */

export type DirectSendSignals = {
  /** 界面认为该会话正在跑。 */
  running: boolean
  /** 用户手动停止过（即使 running 已被清掉，也不许直发）。 */
  stoppedByUser: boolean
  /** 上一轮没正常结束（异常收尾 / 回合被外力打断）。 */
  abnormalEnd: boolean
  /** 界面显示已结束、但实际仍在后台跑（UI 与真实运行态不一致）。 */
  uiBehindBackground: boolean
}

export type DirectSendDecision = {
  /** 是否允许直接进入对话。 */
  allow: boolean
  /**
   * 不允许直发的原因（英文枚举，供调用方挑文案；不需要文案时可忽略）。
   * `null` 表示允许直发。
   */
  reason: null | 'stopped-by-user' | 'abnormal-end' | 'ui-behind-background'
  /** 是否**只是**"界面认为在跑"而真实状态没在跑（另一种需要知情的形态）。 */
  notTrulyRunning: boolean
}

/**
 * 判定顺序（按用户规则 ✓）：
 *  1. 只有在"**真的**在正常跑"（running ✓ 且没被停过 ✓ 且上一轮正常结束 ✓ 且 UI 与真实一致 ✓）时才允许直发；
 *  2. 命中任一条禁止项 ⇒ 不允许直发，并给出原因；
 *  3. 连 running 都不是 ⇒ 也不允许直发（今天它会走"排队/新回合"那条路，这里只负责"能不能直发"）。
 */
export function directSendDecision(signals: DirectSendSignals): DirectSendDecision {
  const stopping = signals.stoppedByUser
  const abnormal = signals.abnormalEnd
  const uiBehind = signals.uiBehindBackground
  if (stopping || abnormal || uiBehind) {
    return {
      allow: false,
      reason: stopping ? 'stopped-by-user' : abnormal ? 'abnormal-end' : 'ui-behind-background',
      notTrulyRunning: false,
    }
  }
  if (!signals.running) {
    // 没在跑：也不是"直发进正在跑的回合"。
    return { allow: false, reason: null, notTrulyRunning: true }
  }
  return { allow: true, reason: null, notTrulyRunning: false }
}
