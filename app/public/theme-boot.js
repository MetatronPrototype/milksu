/* Blocking classic script. Keep in sync with app/src/lib/themeMode.ts.
 * Official Vue and adhoc Stable share Electron userData; `light` / `dark`
 * mean that appearance, not a next-themes toggle class. */
(function applyStoredThemeMode() {
  var key = 'milksu.theme-mode'
  var mode = 'system'
  try {
    var stored = window.localStorage.getItem(key)
    if (stored === 'light' || stored === 'dark' || stored === 'system') mode = stored
  } catch (error) {
    mode = 'system'
  }
  var prefersDark = false
  try {
    prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch (error) {
    prefersDark = false
  }
  var resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
  var root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themeMode = mode
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
})()

/* Keep preset ids and px sizes in sync with app/src/lib/uiFonts.ts. Stacks live in CSS. */
;(function applyStoredUiFonts() {
  var families = {
    product: 1,
    inter: 1,
    'noto-sc': 1,
    'ibm-plex': 1,
    'source-sans': 1,
    geist: 1,
    'nunito-sans': 1,
    'noto-serif-sc': 1,
    'zcool-xiaowei': 1,
    'zcool-qingke': 1,
    system: 1,
  }
  function readFamily(key) {
    try {
      var value = window.localStorage.getItem(key)
      return families[value] ? value : 'product'
    } catch (error) {
      return 'product'
    }
  }
  function readSize(key) {
    try {
      var raw = String(window.localStorage.getItem(key) || '').replace(/px$/i, '')
      var n = parseInt(raw, 10)
      if (n >= 11 && n <= 18) return String(n)
    } catch (error) {
      /* private mode or blocked storage */
    }
    return '13'
  }
  var root = document.documentElement
  var uiSize = readSize('milksu.ui-font-size')
  var conversationSize = readSize('milksu.conversation-font-size')
  root.dataset.uiFont = readFamily('milksu.ui-font')
  root.dataset.conversationFont = readFamily('milksu.conversation-font')
  root.dataset.uiFontSize = uiSize
  root.dataset.conversationFontSize = conversationSize
  root.style.setProperty('--ui-font-size', uiSize + 'px')
  root.style.setProperty('--conversation-font-size', conversationSize + 'px')
})()
