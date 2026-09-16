// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyUiFonts,
  FACTORY_UI_FONT,
  FACTORY_UI_FONT_SIZE,
  normalizeUiFontPreset,
  normalizeUiFontSize,
} from './uiFonts'

describe('uiFonts', () => {
  afterEach(() => {
    const root = document.documentElement
    root.removeAttribute('data-ui-font')
    root.removeAttribute('data-conversation-font')
    root.removeAttribute('data-ui-font-size')
    root.removeAttribute('data-conversation-font-size')
    root.style.removeProperty('--ui-font-size')
    root.style.removeProperty('--conversation-font-size')
  })

  it('defaults unknown values to the product stack', () => {
    expect(normalizeUiFontPreset('')).toBe(FACTORY_UI_FONT)
    expect(normalizeUiFontPreset('Comic Sans')).toBe(FACTORY_UI_FONT)
    expect(normalizeUiFontPreset('noto-sc')).toBe('noto-sc')
    expect(normalizeUiFontPreset('ibm-plex-sans')).toBe('ibm-plex')
    expect(normalizeUiFontPreset('zcool-xiaowei')).toBe('zcool-xiaowei')
  })

  it('normalizes concrete px sizes and rejects presets', () => {
    expect(normalizeUiFontSize('')).toBe(FACTORY_UI_FONT_SIZE)
    expect(normalizeUiFontSize('13')).toBe('13')
    expect(normalizeUiFontSize('14px')).toBe('14')
    expect(normalizeUiFontSize(16)).toBe('16')
    expect(normalizeUiFontSize('11')).toBe('11')
    expect(normalizeUiFontSize('18')).toBe('18')
    expect(normalizeUiFontSize('10')).toBe(FACTORY_UI_FONT_SIZE)
    expect(normalizeUiFontSize('19')).toBe(FACTORY_UI_FONT_SIZE)
    expect(normalizeUiFontSize('small')).toBe(FACTORY_UI_FONT_SIZE)
    expect(normalizeUiFontSize('large')).toBe(FACTORY_UI_FONT_SIZE)
    expect(normalizeUiFontSize('默认')).toBe(FACTORY_UI_FONT_SIZE)
  })

  it('applies presets and px sizes to the document', () => {
    const next = applyUiFonts({
      uiFont: 'geist',
      conversationFont: 'noto-serif-sc',
      uiFontSize: '15',
      conversationFontSize: '12',
    })
    expect(next).toEqual({
      uiFont: 'geist',
      conversationFont: 'noto-serif-sc',
      uiFontSize: '15',
      conversationFontSize: '12',
    })
    expect(document.documentElement.dataset.uiFont).toBe('geist')
    expect(document.documentElement.dataset.conversationFont).toBe('noto-serif-sc')
    expect(document.documentElement.dataset.uiFontSize).toBe('15')
    expect(document.documentElement.dataset.conversationFontSize).toBe('12')
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('15px')
    expect(document.documentElement.style.getPropertyValue('--conversation-font-size')).toBe('12px')
  })

  it('does not reset unspecified fields', () => {
    applyUiFonts({
      uiFont: 'inter',
      conversationFont: 'system',
      uiFontSize: '16',
      conversationFontSize: '11',
    })
    const next = applyUiFonts({ uiFont: 'ibm-plex' })
    expect(next).toEqual({
      uiFont: 'ibm-plex',
      conversationFont: 'system',
      uiFontSize: '16',
      conversationFontSize: '11',
    })
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('16px')
    expect(document.documentElement.style.getPropertyValue('--conversation-font-size')).toBe('11px')
  })
})
