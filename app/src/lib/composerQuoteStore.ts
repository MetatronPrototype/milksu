/**
 * Quotes are kept per conversation, keyed exactly like the composer draft, so switching to another
 * conversation and back does not lose what the reader had selected. Same lifetime as the draft:
 * persisted to local storage (like the draft), cleared once the message is sent.
 */
import type { ComposerQuote } from '@/lib/composerQuote'

const quotesByKey = new Map<string, ComposerQuote[]>()
const STORAGE_KEY = 'milksu.composer-quotes.v1'

function normalize(key: string) {
  return String(key ?? '').trim()
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // 隐私模式等场景访问 localStorage 会抛异常：退化成纯内存，不影响使用。
    return null
  }
}

function flush() {
  const store = storage()
  if (!store) return
  try {
    if (!quotesByKey.size) {
      store.removeItem(STORAGE_KEY)
      return
    }
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(quotesByKey)))
  } catch {
    // 配额满等情况：内存里的引用仍然可用。
  }
}

function hydrate() {
  const store = storage()
  if (!store) return
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, ComposerQuote[]>
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (!Array.isArray(value)) continue
      const usable = value.filter(
        quote => String(quote?.id ?? '').trim() && String(quote?.text ?? '').trim(),
      )
      if (usable.length) quotesByKey.set(key, usable)
    }
  } catch {
    // 损坏的存档不影响启动：当作没有引用。
  }
}

hydrate()

export function readComposerQuotes(key: string): ComposerQuote[] | undefined {
  const stored = quotesByKey.get(normalize(key))
  if (!stored) return undefined
  // Hand out copies so a caller cannot mutate the stored list in place.
  return stored.map(quote => ({ ...quote }))
}

export function writeComposerQuotes(key: string, quotes: readonly ComposerQuote[]) {
  const normalized = normalize(key)
  if (!normalized) return
  const usable = (quotes ?? [])
    .filter(quote => String(quote?.id ?? '').trim() && String(quote?.text ?? '').trim())
    .map(quote => ({ id: String(quote.id), text: String(quote.text), sourceLabel: quote.sourceLabel }))
  if (!usable.length) {
    quotesByKey.delete(normalized)
    flush()
    return
  }
  quotesByKey.set(normalized, usable)
  flush()
}

export function clearComposerQuotes(key: string) {
  quotesByKey.delete(normalize(key))
  flush()
}

export function resetComposerQuotes() {
  quotesByKey.clear()
  flush()
}
