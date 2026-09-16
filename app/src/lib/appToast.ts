export type AppToastTone = 'default' | 'destructive'

export type AppToast = {
  id: string
  title: string
  tone: AppToastTone
}

type Listener = (toasts: AppToast[]) => void

const toasts: AppToast[] = []
const listeners = new Set<Listener>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function emit() {
  const snapshot = toasts.slice()
  for (const listener of listeners) listener(snapshot)
}

export function redactToastText(value: string) {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-…')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\b/g, '…')
    .replace(/\b((?:api[_-]?key|token|secret|bearer|authorization)\s*[:=]\s*)\S+/gi, '$1…')
    .trim()
}

export function toast(title: string, options?: { tone?: AppToastTone; durationMs?: number }) {
  const text = redactToastText(String(title ?? ''))
  if (!text) return ''
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  toasts.push({ id, title: text, tone: options?.tone ?? 'default' })
  if (toasts.length > 3) toasts.shift()
  const duration = options?.durationMs ?? 4000
  if (duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), duration))
  }
  emit()
  return id
}

export function toastError(reason: unknown, fallback: string) {
  const message = reason instanceof Error && reason.message.trim() ? reason.message : fallback
  return toast(message, { tone: 'destructive' })
}

export function dismissToast(id: string) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const index = toasts.findIndex(item => item.id === id)
  if (index < 0) return
  toasts.splice(index, 1)
  emit()
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener)
  listener(toasts.slice())
  return () => {
    listeners.delete(listener)
  }
}

export function resetToastsForTests() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  toasts.splice(0, toasts.length)
  emit()
}
