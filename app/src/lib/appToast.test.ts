import { afterEach, describe, expect, it, vi } from 'vitest'
import { redactToastText, resetToastsForTests, subscribeToasts, toast, toastError } from '@/lib/appToast'

describe('app toast', () => {
  afterEach(() => {
    resetToastsForTests()
  })

  it('redacts provider key-shaped text before display', () => {
    expect(redactToastText('failed sk-abcdefghijklmnopqrstuvwxyz')).toContain('sk-…')
    expect(redactToastText('failed sk-abcdefghijklmnopqrstuvwxyz')).not.toContain('sk-abcdefghijklmn')
    expect(redactToastText('api_key=abc123secret')).toMatch(/api_key\s*[:=]\s*…/i)
  })

  it('drops empty or fully redacted titles', () => {
    expect(toast('   ')).toBe('')
  })

  it('publishes a short-lived toast and toastError fallback', () => {
    vi.useFakeTimers()
    const seen: string[][] = []
    const stop = subscribeToasts(items => seen.push(items.map(item => item.title)))
    toast('下载失败')
    toastError(new Error('sk-abcdefghijklmnopqrstuvwxyz missing'), '失败')
    expect(seen.at(-1)).toEqual(['下载失败', 'sk-… missing'])
    vi.runAllTimers()
    expect(seen.at(-1)).toEqual([])
    stop()
    vi.useRealTimers()
  })
})
