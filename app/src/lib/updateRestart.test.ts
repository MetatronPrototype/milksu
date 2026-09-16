import { describe, expect, it } from 'vitest'
import {
  planUpdateRestart,
  selectUpdateResumeConversation,
  updateControlVisible,
} from './updateRestart'

describe('update restart plan', () => {
  it('installs immediately when no turn is running', () => {
    expect(planUpdateRestart({
      runningConversationIds: [],
      restartDeferred: false,
    })).toBe('install')
  })

  it('asks before quitting a running turn', () => {
    expect(planUpdateRestart({
      runningConversationIds: ['conversation-1'],
      restartDeferred: false,
    })).toBe('confirm')
  })

  it('stays in the current app after the user cancels', () => {
    expect(planUpdateRestart({
      runningConversationIds: ['conversation-1'],
      restartDeferred: true,
    })).toBe('stay')
    expect(planUpdateRestart({
      runningConversationIds: [],
      restartDeferred: true,
    })).toBe('stay')
  })

  it('resumes the conversation that was active when the update restarted', () => {
    expect(selectUpdateResumeConversation({
      conversationIds: ['a', 'b'],
      activeConversationId: 'b',
    })).toBe('b')
    expect(selectUpdateResumeConversation({
      conversationIds: ['a'],
      activeConversationId: 'missing',
    })).toBe('a')
    expect(selectUpdateResumeConversation({
      conversationIds: [],
      activeConversationId: 'a',
    })).toBeNull()
  })

  it('keeps one sidebar update control across download and install', () => {
    expect(updateControlVisible('available')).toBe(true)
    expect(updateControlVisible('downloading')).toBe(true)
    expect(updateControlVisible('downloaded')).toBe(true)
    expect(updateControlVisible('error')).toBe(true)
    expect(updateControlVisible('idle')).toBe(false)
    expect(updateControlVisible('checking')).toBe(false)
  })
})
