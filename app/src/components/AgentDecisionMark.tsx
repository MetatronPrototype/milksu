import { useT } from '@/hooks/useUiLocale'

// 与 AgentPixelLoader 同一套 9 格方阵（3×3），只把点亮的格子与颜色换掉：
// 第 1 行整行（横）+ 第 2 行最右（钩子）+ 第 3 行中间（点）= 一个"?"。
// 顺序按行优先，`true` 表示这一格点亮；动画与呼吸节奏交给 CSS（只动 opacity，走合成层）。
const QUESTION_MARK_CELLS = [
  true, true, true,
  false, false, true,
  false, true, false,
]

/**
 * 「这个会话在等你拍板」的标记（侧栏用）。琥珀色、缓慢呼吸，**不是**"运行中"那种快跳。
 *
 * 复用 AgentPixelLoader 的网格与格子尺寸，所以换标记时侧栏不会跳动；`aria-label` 双语，
 * `role="status"` 保留（与运行中标记同语义：这是状态，不是按钮）。
 */
export default function AgentDecisionMark({ label }: { label?: string }) {
  const t = useT()
  const text = label ?? t('需要你决定', 'Needs your decision')
  return (
    <span className="agent-pixel-loader agent-pixel-loader--decision" role="status" aria-label={text}>
      <span className="agent-pixel agent-pixel--decision" aria-hidden="true">
        {QUESTION_MARK_CELLS.map((on, index) => (
          <span
            key={index}
            className={`agent-pixel__cell${on ? ' agent-pixel__cell--decision-on' : ''}`}
          />
        ))}
      </span>
    </span>
  )
}
