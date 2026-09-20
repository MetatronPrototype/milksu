import { useT } from '@/hooks/useUiLocale'

// 3×3 点阵：中心那一格（索引 4）**留空** ⇒ 看上去是 8 个方形小格绕成一圈。
const DECISION_RING_SLOTS = 9
const DECISION_RING_CENTER = 4

/**
 * 「这个会话在等你拍板」的标记（侧栏用）。
 *
 * 形态：**3×3 像素点阵，中心留空** ⇒ 8 个小方格雷成一圈、**琥珀色** —— 沿用 `AgentPixelLoader`
 * 的像素语言（同样的方形小格风格），但中心空出来才像个"圈"，同时比原来的 9 格更抓眼。
 *
 * 整组尺寸与侧栏其它行内图标一致（`size-3.5` = 14px）；整组做轻微呼吸（opacity/scale，2.4 秒级），
 * **不**逐格跑马灯/闪烁；`prefers-reduced-motion` 仍关掉动画。
 * 无障碍：`role="status"` + 双语 `aria-label`（这是状态，不是按钮）。
 */
export default function AgentDecisionMark({ label }: { label?: string }) {
  const t = useT()
  const text = label ?? t('需要你决定', 'Needs your decision')
  return (
    <span
      className="agent-decision-grid inline-flex size-3.5 items-center justify-center"
      role="status"
      aria-label={text}
    >
      <span className="agent-decision-grid__cells grid grid-cols-3 gap-px" aria-hidden="true">
        {Array.from({ length: DECISION_RING_SLOTS }, (_slot, index) => (
          index === DECISION_RING_CENTER
            // 中心留空：占位但不画格子，所以"没有格子元素"是可断言的。
            ? <span key={index} className="agent-decision-grid__hole block" />
            : <span key={index} className="agent-decision-grid__cell block rounded-[1px] bg-amber-500" />
        ))}
      </span>
    </span>
  )
}
