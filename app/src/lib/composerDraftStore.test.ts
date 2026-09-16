import { afterEach, describe, expect, it } from 'vitest'
import {
  clearComposerDraft,
  composerDraftKey,
  readComposerDraft,
  resetComposerDrafts,
  writeComposerDraft,
} from './composerDraftStore'

describe('composerDraftStore', () => {
  afterEach(() => {
    resetComposerDrafts()
  })

  it('keys an empty canvas by workspace home so Coding and CTF drafts do not collide', () => {
    expect(composerDraftKey(undefined, 'chat')).toBe('pending:chat')
    expect(composerDraftKey('', 'ctf')).toBe('pending:ctf')
    expect(composerDraftKey('conversation-1', 'chat')).toBe('conversation-1')
  })

  it('keeps a pending Coding draft after the composer remounts', () => {
    const key = composerDraftKey(null, 'chat')
    writeComposerDraft(key, {
      html: '<div>继续这个修复</div>',
      text: '继续这个修复',
      attachments: [{
        id: 'att-1',
        name: 'note.txt',
        mediaType: 'text/plain',
        size: 4,
        sha256: 'abcd',
      }],
    })

    expect(readComposerDraft(key)).toEqual({
      html: '<div>继续这个修复</div>',
      text: '继续这个修复',
      attachments: [{
        id: 'att-1',
        name: 'note.txt',
        mediaType: 'text/plain',
        size: 4,
        sha256: 'abcd',
      }],
    })
  })

  it('drops a blank draft so a fresh New conversation stays empty', () => {
    const key = composerDraftKey(null, 'chat')
    writeComposerDraft(key, { html: 'typed', text: 'typed', attachments: [] })
    writeComposerDraft(key, { html: '', text: '   ', attachments: [] })
    expect(readComposerDraft(key)).toBeUndefined()
    clearComposerDraft(key)
    expect(readComposerDraft(key)).toBeUndefined()
  })
})
