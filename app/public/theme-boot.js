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
