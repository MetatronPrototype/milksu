import { afterEach, describe, expect, it } from 'vitest'
import { composerDraftKey } from '@/lib/composerDraftStore'
import {
  clearComposerQuotes,
  readComposerQuotes,
  resetComposerQuotes,
  writeComposerQuotes,
} from '@/lib/composerQuoteStore'

afterEach(() => resetComposerQuotes())

describe('composer quote store', () => {
  // Quotes are kept per conversation, exactly like the draft, so switching away and back does not
  // lose what the reader had selected.
  it('keeps quotes per conversation and survives a switch away and back', () => {
    const first = composerDraftKey('conversation-a')
    const second = composerDraftKey('conversation-b')

    writeComposerQuotes(first, [{ id: 'q1', text: '第一条会话的引用' }])
    writeComposerQuotes(second, [{ id: 'q2', text: '第二条会话的引用' }])

    expect(readComposerQuotes(first)).toEqual([{ id: 'q1', text: '第一条会话的引用' }])
    expect(readComposerQuotes(second)).toEqual([{ id: 'q2', text: '第二条会话的引用' }])

    // Switching away and back is just reading the same key again.
    expect(readComposerQuotes(first)?.[0]?.text).toBe('第一条会话的引用')
  })

  // A pending (not yet created) conversation keys by workspace home, the same rule drafts use.
  it('keys a pending conversation by workspace home', () => {
    const key = composerDraftKey(null, 'coding')
    writeComposerQuotes(key, [{ id: 'q1', text: '待创建会话的引用' }])
    expect(readComposerQuotes(key)).toHaveLength(1)
    expect(readComposerQuotes(composerDraftKey(null, 'chat'))).toBeUndefined()
  })

  // Sending clears them; an empty list is the same as none, so no empty record lingers.
  it('clears quotes on send and drops empty lists', () => {
    const key = composerDraftKey('conversation-a')
    writeComposerQuotes(key, [{ id: 'q1', text: '引用' }])
    clearComposerQuotes(key)
    expect(readComposerQuotes(key)).toBeUndefined()

    writeComposerQuotes(key, [{ id: 'q1', text: '引用' }])
    writeComposerQuotes(key, [])
    expect(readComposerQuotes(key)).toBeUndefined()
  })

  // Copies in and out, so a caller cannot mutate the stored list by accident.
  it('hands out copies', () => {
    const key = composerDraftKey('conversation-a')
    const input = [{ id: 'q1', text: '引用' }]
    writeComposerQuotes(key, input)
    input[0]!.text = '被改掉了'
    expect(readComposerQuotes(key)?.[0]?.text).toBe('引用')

    const read = readComposerQuotes(key)
    read![0]!.text = '又被改掉了'
    expect(readComposerQuotes(key)?.[0]?.text).toBe('引用')
  })
})
