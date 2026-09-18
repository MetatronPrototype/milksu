/**
 * Quotes are kept per conversation, keyed exactly like the composer draft, so switching to another
 * conversation and back does not lose what the reader had selected. Same lifetime as the draft:
 * in memory for the session, cleared once the message is sent.
 */
import type { ComposerQuote } from '@/lib/composerQuote'

const quotesByKey = new Map<string, ComposerQuote[]>()

function normalize(key: string) {
  return String(key ?? '').trim()
}

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
    return
  }
  quotesByKey.set(normalized, usable)
}

export function clearComposerQuotes(key: string) {
  quotesByKey.delete(normalize(key))
}

export function resetComposerQuotes() {
  quotesByKey.clear()
}
