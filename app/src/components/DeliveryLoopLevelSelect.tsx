import { useT } from '@/hooks/useUiLocale'
import {
  DELIVERY_LOOP_LEVELS,
  normalizeDeliveryLoopLevel,
  type DeliveryLoopLevel,
} from '@/lib/deliveryLoopLevel'

/**
 * 熔断档位的三选一（严格 / 标准 / 宽松）。**没有"关闭"** —— 熔断防的是两个 agent 永远停不下来。
 *
 * 显示值先做一次归一化：拿不到/非法 ⇒ 显示**标准**（与后端一致），绝不显示成"没在防护"。
 */
export function DeliveryLoopLevelSelect({
  value,
  disabled = false,
  onChange,
}: {
  value: unknown
  disabled?: boolean
  onChange: (level: DeliveryLoopLevel) => void
}) {
  const t = useT()
  const current = normalizeDeliveryLoopLevel(value)
  const labels: Record<DeliveryLoopLevel, string> = {
    strict: t('严格', 'Strict'),
    standard: t('标准', 'Standard'),
    loose: t('宽松', 'Loose'),
  }
  return (
    <div
      role="radiogroup"
      aria-label={t('投递熔断档位', 'Delivery loop breaker level')}
      className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5"
    >
      {DELIVERY_LOOP_LEVELS.map(level => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={current === level}
          disabled={disabled}
          className={`rounded-md px-2.5 py-1 text-caption ${current === level ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => onChange(level)}
        >
          {labels[level]}
        </button>
      ))}
    </div>
  )
}

export default DeliveryLoopLevelSelect
