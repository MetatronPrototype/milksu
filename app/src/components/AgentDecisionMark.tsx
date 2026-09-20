import { useT } from '@/hooks/useUiLocale'

/**
 * 「这个会话在等你拍板」的标记（侧栏用）。
 *
 * 形态：**琥珀色圆环**（较粗描边 + 一点点外发光），直径与侧栏其它行内图标一致（`size-3.5` = 14px）。
 * 之前是 3×3 像素方阵，用户真机反馈"不太可见" —— 小方阵在深色底上太碎，圆环更抓眼。
 *
 * 克制：只有缓慢的 opacity/scale 呼吸（不做闪烁）；颜色用仓库既有的 amber token（不硬编码色值）。
 * 无障碍：`role="status"` + 双语 `aria-label`（这是状态，不是按钮）。
 */
export default function AgentDecisionMark({ label }: { label?: string }) {
  const t = useT()
  const text = label ?? t('需要你决定', 'Needs your decision')
  return (
    <span
      className="agent-decision-ring inline-flex size-3.5 items-center justify-center"
      role="status"
      aria-label={text}
    >
      <span className="agent-decision-ring__circle block size-3.5 rounded-full border-2 border-amber-500 bg-amber-500/15" aria-hidden="true" />
    </span>
  )
}
