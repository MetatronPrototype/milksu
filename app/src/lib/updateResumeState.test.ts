// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  UPDATE_RESUME_STATE_STORAGE_KEY,
  consumeUpdateResumeState,
  readUpdateResumeState,
  writeUpdateResumeState,
  type UpdateResumeState,
} from './updateResumeState'

describe('updateResumeState', () => {
  it('round trips running conversations so the next launch can continue them', () => {
    const storage = createMemoryStorage()
    const state: UpdateResumeState = {
      version: 1,
      conversationIds: ['conversation-1', 'conversation-2'],
      activeConversationId: 'conversation-2',
    }

    writeUpdateResumeState(state, storage)

    expect(readUpdateResumeState(storage)).toEqual(state)
    expect(consumeUpdateResumeState(storage)).toEqual(state)
    expect(readUpdateResumeState(storage)).toBeNull()
  })

  it('rejects empty or malformed resume markers', () => {
    const storage = createMemoryStorage()
    expect(readUpdateResumeState(storage)).toBeNull()

    storage.setItem(UPDATE_RESUME_STATE_STORAGE_KEY, '{broken')
    expect(readUpdateResumeState(storage)).toBeNull()

    writeUpdateResumeState({
      version: 1,
      conversationIds: [],
      activeConversationId: 'conversation-1',
    }, storage)
    expect(storage.getItem(UPDATE_RESUME_STATE_STORAGE_KEY)).toBeNull()

    storage.setItem(UPDATE_RESUME_STATE_STORAGE_KEY, JSON.stringify({
      version: 1,
      conversationIds: [1, '', 'conversation-1'],
      activeConversationId: 12,
    }))
    expect(readUpdateResumeState(storage)).toEqual({
      version: 1,
      conversationIds: ['conversation-1'],
      activeConversationId: null,
    })
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return Array.from(values.keys())[index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, value) },
  }
}
