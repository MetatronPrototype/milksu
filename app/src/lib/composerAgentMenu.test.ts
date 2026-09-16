import { describe, expect, it } from 'vitest'
import { layoutComposerAgentFlyout } from '@/lib/composerAgentMenu'

describe('composer agent flyout', () => {
  it('flips left and pins to the bottom near the composer', () => {
    const next = layoutComposerAgentFlyout(
      { top: 640, right: 1180, bottom: 780 },
      { width: 1280, height: 800 },
      'model',
    )
    expect(next.right).toBe(false)
    expect(next.alignBottom).toBe(true)
    expect(next.maxHeight).toBeLessThanOrEqual(800 - 16)
    expect(next.maxHeight).toBeGreaterThanOrEqual(160)
  })

  it('opens to the right and down when there is room', () => {
    const next = layoutComposerAgentFlyout(
      { top: 80, right: 400, bottom: 220 },
      { width: 1280, height: 800 },
      'model',
    )
    expect(next.right).toBe(true)
    expect(next.alignBottom).toBe(false)
    expect(next.maxHeight).toBe(800 - 80 - 8)
  })
})
