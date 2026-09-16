import { t } from '@/lib/uiLocale'

export function formatRelativeAge(at: number, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return ''
  const delta = Math.max(0, now - at)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return t('刚刚', 'now')
  if (delta < hour) return `${Math.floor(delta / minute)}m`
  if (delta < day) return `${Math.floor(delta / hour)}h`
  if (delta < 30 * day) return `${Math.floor(delta / day)}d`
  return `${Math.floor(delta / (7 * day))}w`
}
