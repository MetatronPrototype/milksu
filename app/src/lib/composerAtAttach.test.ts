import { describe, expect, it } from 'vitest'
import { composerAtAttachTrigger } from '@/lib/composerAtAttach'

describe('composer @ attach trigger', () => {
  it('opens the existing picker only for a bare @ token', () => {
    expect(composerAtAttachTrigger('@')).toBe(true)
    expect(composerAtAttachTrigger('see @')).toBe(true)
    expect(composerAtAttachTrigger('@readme')).toBe(false)
    expect(composerAtAttachTrigger('email@')).toBe(false)
    expect(composerAtAttachTrigger('')).toBe(false)
  })
})
