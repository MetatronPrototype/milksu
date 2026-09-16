export const COMPOSER_ADD_MENU_HEIGHT_CAP = 24 * 16
export const COMPOSER_ADD_MENU_HEIGHT_FLOOR = 10 * 16
export const COMPOSER_ADD_MENU_VIEW_MARGIN = 16

export function layoutComposerAddMenu(
  trigger: { top: number; bottom: number } | null | undefined,
  viewport: { height: number },
) {
  const margin = COMPOSER_ADD_MENU_VIEW_MARGIN
  const above = Math.max(0, (trigger?.top ?? 0) - margin)
  const below = Math.max(0, viewport.height - (trigger?.bottom ?? 0) - margin)
  const available = Math.max(above, below)
  return {
    maxHeight: Math.max(
      COMPOSER_ADD_MENU_HEIGHT_FLOOR,
      Math.min(COMPOSER_ADD_MENU_HEIGHT_CAP, Math.floor(available)),
    ),
  }
}
