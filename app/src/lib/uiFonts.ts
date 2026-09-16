export const UI_FONT_PRESET_IDS = [
  'product',
  'inter',
  'noto-sc',
  'ibm-plex',
  'source-sans',
  'geist',
  'nunito-sans',
  'noto-serif-sc',
  'zcool-xiaowei',
  'zcool-qingke',
  'system',
] as const

export const UI_FONT_SIZE_MIN = 11
export const UI_FONT_SIZE_MAX = 18
export const UI_FONT_SIZE_IDS = ['11', '12', '13', '14', '15', '16', '17', '18'] as const

export type UiFontPreset = (typeof UI_FONT_PRESET_IDS)[number]
export type UiFontSize = (typeof UI_FONT_SIZE_IDS)[number]

export const UI_FONT_STORAGE_KEYS = {
  ui: 'milksu.ui-font',
  conversation: 'milksu.conversation-font',
  uiSize: 'milksu.ui-font-size',
  conversationSize: 'milksu.conversation-font-size',
} as const

export const FACTORY_UI_FONT: UiFontPreset = 'product'
export const FACTORY_UI_FONT_SIZE: UiFontSize = '13'

const UI_FONT_ALIASES: Record<string, UiFontPreset> = {
  noto: 'noto-sc',
  'noto-sans-sc': 'noto-sc',
  'system-ui': 'system',
  ibm: 'ibm-plex',
  'ibm-plex-sans': 'ibm-plex',
  source: 'source-sans',
  'source-sans-3': 'source-sans',
  nunito: 'nunito-sans',
  'noto-serif': 'noto-serif-sc',
  xiaowei: 'zcool-xiaowei',
  qingke: 'zcool-qingke',
  huangyou: 'zcool-qingke',
}

export function normalizeUiFontPreset(value: unknown): UiFontPreset {
  const raw = String(value ?? '').trim().toLowerCase()
  if ((UI_FONT_PRESET_IDS as readonly string[]).includes(raw)) return raw as UiFontPreset
  return UI_FONT_ALIASES[raw] ?? FACTORY_UI_FONT
}

export function normalizeUiFontSize(value: unknown): UiFontSize {
  const raw = String(value ?? '').trim().replace(/px$/i, '').trim()
  const parsed = Number.parseInt(raw, 10)
  if (Number.isInteger(parsed) && parsed >= UI_FONT_SIZE_MIN && parsed <= UI_FONT_SIZE_MAX) {
    return String(parsed) as UiFontSize
  }
  return FACTORY_UI_FONT_SIZE
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode or blocked storage */
  }
}

function writeFontSizeVar(name: '--ui-font-size' | '--conversation-font-size', size: UiFontSize) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(name, `${size}px`)
}

function readCurrentFonts(): {
  uiFont: UiFontPreset
  conversationFont: UiFontPreset
  uiFontSize: UiFontSize
  conversationFontSize: UiFontSize
} {
  if (typeof document === 'undefined') {
    return {
      uiFont: FACTORY_UI_FONT,
      conversationFont: FACTORY_UI_FONT,
      uiFontSize: FACTORY_UI_FONT_SIZE,
      conversationFontSize: FACTORY_UI_FONT_SIZE,
    }
  }
  const { dataset } = document.documentElement
  return {
    uiFont: normalizeUiFontPreset(dataset.uiFont),
    conversationFont: normalizeUiFontPreset(dataset.conversationFont),
    uiFontSize: normalizeUiFontSize(dataset.uiFontSize),
    conversationFontSize: normalizeUiFontSize(dataset.conversationFontSize),
  }
}

export function applyUiFonts(input: {
  uiFont?: unknown
  conversationFont?: unknown
  uiFontSize?: unknown
  conversationFontSize?: unknown
}) {
  const current = readCurrentFonts()
  const uiFont = input.uiFont !== undefined ? normalizeUiFontPreset(input.uiFont) : current.uiFont
  const conversationFont = input.conversationFont !== undefined
    ? normalizeUiFontPreset(input.conversationFont)
    : current.conversationFont
  const uiFontSize = input.uiFontSize !== undefined
    ? normalizeUiFontSize(input.uiFontSize)
    : current.uiFontSize
  const conversationFontSize = input.conversationFontSize !== undefined
    ? normalizeUiFontSize(input.conversationFontSize)
    : current.conversationFontSize
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.dataset.uiFont = uiFont
    root.dataset.conversationFont = conversationFont
    root.dataset.uiFontSize = uiFontSize
    root.dataset.conversationFontSize = conversationFontSize
    writeFontSizeVar('--ui-font-size', uiFontSize)
    writeFontSizeVar('--conversation-font-size', conversationFontSize)
  }
  writeStored(UI_FONT_STORAGE_KEYS.ui, uiFont)
  writeStored(UI_FONT_STORAGE_KEYS.conversation, conversationFont)
  writeStored(UI_FONT_STORAGE_KEYS.uiSize, uiFontSize)
  writeStored(UI_FONT_STORAGE_KEYS.conversationSize, conversationFontSize)
  return { uiFont, conversationFont, uiFontSize, conversationFontSize }
}
