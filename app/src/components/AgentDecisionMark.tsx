import { useT } from '@/hooks/useUiLocale'

// 3×3 点阵：中心那一格（索引 4）**留空** ⇒ 8 个方形小格绕成一圈。
const DECISION_RING_SLOTS = 9
const DECISION_RING_CENTER = 4

/**
 * 「这个会话在等你拍板」的标记（侧栏用）。
 *
 * 形态：**3×3 像素点阵、中心留空** ⇒ 8 个小方格雷成一圈、**琥珀色**。
 *
 * 尺寸**复用原版 `AgentPixelLoader` 的网格**（`.agent-pixel` = `repeat(3, 4px)` + `gap: 1.5px`；
 * `.agent-pixel__cell` = 4×4 + `border-radius: 1px`）—— 这里只用修饰类改**颜色与动画**：
 * 原版的两条规则**一个字都没改**，所以运行中那个 loader 的渲染结果不变；而两个标记并排时尺寸完全一致
 * （用户反馈"尺寸和原来的不对"，就是指这里）。
 *
 * 克制的整组呼吸（2.4 秒级，不是逐格跑马灯/闪烁）；`prefers-reduced-motion` 仍关掉动画。
 * 无障碍：`role="status"` + 双语 `aria-label`（这是状态，不是按钮）。
 */
/** 叉形 = 左上/右上/中心/左下/右下（3×3 里的 0/2/4/6/8），其余四格留空。 */
const PROBLEM_SLOTS = new Set([0, 2, 4, 6, 8])

export default function AgentDecisionMark({
  label,
  variant = 'decision',
}: {
  label?: string
  /** `decision` = 等你拍板（琥珀色一圈）；`problem` = 这个对话遇到了问题（红色叉）。 */
  variant?: 'decision' | 'problem'
}) {
  const t = useT()
  const problem = variant === 'problem'
  const text = label ?? (problem
    ? t('这个对话遇到了问题（上一轮被强制终止）', 'This conversation hit a problem (the last turn was stopped)')
    : t('需要你决定', 'Needs your decision'))
  return (
    <span className="agent-decision-mark inline-flex items-center" role="status" aria-label={text}>
      <span
        className={problem ? 'agent-pixel agent-pixel--problem' : 'agent-pixel agent-pixel--decision'}
        aria-hidden="true"
      >
        {Array.from({ length: DECISION_RING_SLOTS }, (_slot, index) => (
          problem
            // 叉形：点亮五格，其余四格留空（空那四格不带格子类，和中心留空同一个做法）。
            ? (PROBLEM_SLOTS.has(index)
                ? <span key={index} className="agent-pixel__cell agent-pixel__cell--problem" />
                : <span key={index} className="agent-pixel__cell--hole" />)
            : index === DECISION_RING_CENTER
              // 中心留空：占位但不画格子，所以"没有格子元素"是可断言的。
              ? <span key={index} className="agent-pixel__cell--hole" />
              : <span key={index} className="agent-pixel__cell agent-pixel__cell--decision" />
        ))}
      </span>
    </span>
  )
}
