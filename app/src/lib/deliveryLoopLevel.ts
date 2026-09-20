/**
 * 熔断档位（严格 / 标准 / 宽松）的取值与归一化。
 *
 * 与后端 `config.NormalizeDeliveryLoopLevel` 保持**同一套语义**：拿不到、空、拼错、还是别人写的
 * 怪值 ⇒ 一律**标准** —— 界面上不能显示一个"看起来关掉了防护"的状态，也不能因为坏值放宽熔断。
 * 这里刻意没有"关闭"档：熔断防的是两个 agent 永远停不下来。
 */

export const DELIVERY_LOOP_LEVELS = ['strict', 'standard', 'loose'] as const

export type DeliveryLoopLevel = (typeof DELIVERY_LOOP_LEVELS)[number]

export const DEFAULT_DELIVERY_LOOP_LEVEL: DeliveryLoopLevel = 'standard'

/** 任何未知值都映射到标准档（与后端一致）。 */
export function normalizeDeliveryLoopLevel(value: unknown): DeliveryLoopLevel {
  const normalized = String(value ?? '').trim().toLowerCase()
  return (DELIVERY_LOOP_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as DeliveryLoopLevel)
    : DEFAULT_DELIVERY_LOOP_LEVEL
}

/**
 * 把档位写回协作设置对象：保留其它字段，只改 `loop_level`；未设置（标准）时**不写这个键**，
 * 这样默认配置的文件不会被写脏（与后端 `omitempty` 的行为一致）。
 */
export function withDeliveryLoopLevel<T extends Record<string, unknown>>(
  settings: T | undefined,
  level: unknown,
): T & { loop_level?: DeliveryLoopLevel } {
  const next = { ...(settings ?? {}) } as T & { loop_level?: DeliveryLoopLevel }
  const normalized = normalizeDeliveryLoopLevel(level)
  if (normalized === DEFAULT_DELIVERY_LOOP_LEVEL) {
    delete next.loop_level
  } else {
    next.loop_level = normalized
  }
  return next
}
