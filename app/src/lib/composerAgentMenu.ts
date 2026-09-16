export type ComposerAgentPane = 'model' | 'runtime' | 'thinking'

export function layoutComposerAgentFlyout(
  panel: { top: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  pane: ComposerAgentPane,
) {
  const margin = 8
  const needWidth = pane === 'model' ? 360 : 200
  const wantHeight = pane === 'model' ? 352 : 200
  const spaceBelow = viewport.height - panel.top - margin
  const spaceAbove = panel.bottom - margin
  const alignBottom = spaceBelow < wantHeight
  const available = alignBottom ? Math.max(spaceBelow, spaceAbove) : spaceBelow
  return {
    right: viewport.width - panel.right - margin >= needWidth,
    alignBottom,
    maxHeight: Math.max(160, Math.min(available, viewport.height - margin * 2)),
  }
}
