import { describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import {
  SESSION_SIZE_WARNING_BYTES,
  formatSessionSize,
  messageSizeChars,
  sessionPendingContextChars,
  sessionSizeReport,
  sessionSizeWarningKey,
} from './sessionSizeWarning'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  }
}

describe('sessionSizeWarning', () => {
  it('does not warn for a small conversation', () => {
    const messages = [message({ content: 'hello' }), message({ role: 'user', content: 'hi' })]
    const report = sessionSizeReport(messages)
    expect(report.over).toBe(false)
    expect(report.chars).toBeLessThan(SESSION_SIZE_WARNING_BYTES)
  })

  it('warns once the pending context crosses the threshold', () => {
    const messages = [message({ content: 'x'.repeat(SESSION_SIZE_WARNING_BYTES) })]
    const report = sessionSizeReport(messages)
    expect(report.over).toBe(true)
    expect(report.ratio).toBeGreaterThanOrEqual(1)
  })

  it('counts thinking, tool names, approval input and attachment bytes', () => {
    const withExtras = messageSizeChars(message({
      content: 'c'.repeat(100),
      thinking: 't'.repeat(50),
      toolName: 'bash',
      toolCallId: 'call_1',
      approvalInput: 'a'.repeat(20),
    }))
    const contentOnly = messageSizeChars(message({ content: 'c'.repeat(100) }))
    expect(withExtras).toBeGreaterThan(contentOnly)

    const bytes = sessionPendingContextChars([
      message({ attachments: [{ id: 'a', name: 'n', mediaType: 'image/png', size: 5_000_000, sha256: 'x' }] }),
    ])
    expect(bytes).toBeGreaterThanOrEqual(5_000_000)
  })

  it('handles missing or empty inputs without throwing', () => {
    expect(sessionPendingContextChars(undefined)).toBe(0)
    expect(sessionPendingContextChars([])).toBe(0)
    expect(sessionSizeReport(undefined).over).toBe(false)
  })

  it('formats sizes for the banner copy', () => {
    expect(formatSessionSize(512)).toBe('512 B')
    expect(formatSessionSize(2048)).toBe('2 KB')
    expect(formatSessionSize(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatSessionSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })

  it('re-arms the dismissal once the conversation grows another tier', () => {
    const small = sessionSizeReport([message({ content: 'x'.repeat(SESSION_SIZE_WARNING_BYTES) })])
    const bigger = sessionSizeReport([message({ content: 'x'.repeat(SESSION_SIZE_WARNING_BYTES * 3) })])
    expect(sessionSizeWarningKey('conv', small)).not.toBe(sessionSizeWarningKey('conv', bigger))
    expect(sessionSizeWarningKey('a', small)).not.toBe(sessionSizeWarningKey('b', small))
  })
})
