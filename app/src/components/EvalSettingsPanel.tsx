import { createStore, useStore, useStoreRuntime } from '@/lib/reactStore'
import { Bug, Flag, FlaskConical, Square } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import AkLoadingMark from '@/components/AkLoadingMark'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import SearchableModelPicker from '@/components/SearchableModelPicker'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import { hasDesktopRuntime, invokeCommand, isMissingDesktopRuntime, listenEvent } from '@/desktop'
import type { EvalBoardModel, EvalBoardSnapshot, EvalModelRef, EvalSuiteBoard } from '@/evalTypes'
import {
  encodePickerSelection,
  modelCatalogStore,
  parsePickerSelection,
  useModelCatalog,
} from '@/modelCatalog'
import { useT } from '@/hooks/useUiLocale'
import type { AppSettings } from '@/types'

const SUITE_MODELS_KEY = 'milksu.eval.suite-models'
const SELECTED_SUITE_KEY = 'milksu.eval.selected-suite'

function loadSelectedSuite() {
  try {
    const value = localStorage.getItem(SELECTED_SUITE_KEY)
    if (value === 'cybench' || value === 'sec-bench' || value === 'autopen') return value
  } catch {
    // ignore
  }
  return 'cybench'
}

function loadSuiteModels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SUITE_MODELS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) next[key] = value
    }
    return next
  } catch {
    return {}
  }
}

export default function EvalSettingsPanel({
  settings,
}: {
  settings: AppSettings | null
}) {
  const t = useT()
  const store = useStoreRuntime(() => {
    const store = createStore({
      settingsRef: null as AppSettings | null,
      suiteModel: loadSuiteModels(),
      selectedSuite: loadSelectedSuite(),
      board: null as EvalBoardSnapshot | null,
      activityOpen: false,
      error: '',
    })
    let started = false
    const persistSuiteModels = (value: Record<string, string>) => {
      try {
        localStorage.setItem(SUITE_MODELS_KEY, JSON.stringify(value))
      } catch {
        // ignore quota / private-mode failures
      }
    }
    const persistSelectedSuite = (value: string) => {
      try {
        localStorage.setItem(SELECTED_SUITE_KEY, value)
      } catch {
        // ignore quota / private-mode failures
      }
    }
    const s = {
      get settingsRef() { return store.getState().settingsRef },
      set settingsRef(value: AppSettings | null) {
        if (Object.is(store.getState().settingsRef, value)) return
        store.setState({ settingsRef: value })
        applyPickerFallback()
        if (started) syncCatalogSignature()
      },
      get suiteModel() { return store.getState().suiteModel },
      set suiteModel(value: Record<string, string>) {
        if (Object.is(store.getState().suiteModel, value)) return
        store.setState({ suiteModel: value })
        persistSuiteModels(value)
      },
      get selectedSuite() { return store.getState().selectedSuite },
      set selectedSuite(value: string) {
        if (store.getState().selectedSuite === value) return
        store.setState({ selectedSuite: value })
        persistSelectedSuite(value)
      },
      get board() { return store.getState().board },
      set board(value: EvalBoardSnapshot | null) { store.setState({ board: value }) },
      get activityOpen() { return store.getState().activityOpen },
      set activityOpen(value: boolean) {
        if (store.getState().activityOpen === value) return
        store.setState({ activityOpen: value })
      },
      get error() { return store.getState().error },
      set error(value: string) {
        if (store.getState().error === value) return
        store.setState({ error: value })
      },
    }
    const catalog = useModelCatalog(() => ({
      providers: s.settingsRef?.providers ?? {},
      relay: s.settingsRef?.relay ?? null,
    }))
    const pickerGroups = () => catalog.pickerGroups
    const pickerModelLabel = catalog.pickerModelLabel
    let unlisten: (() => void) | undefined
    let stopCatalog: (() => void) | undefined
    let elapsedTimer: ReturnType<typeof setInterval> | undefined
    let boardRequest = 0
    let lastCatalogSignature = ''

    const catalogRefs = () => {
      const seen = new Set<string>()
      const refs: EvalModelRef[] = []
      for (const group of pickerGroups()) {
        for (const model of group.models) {
          const id = String(model ?? '').trim()
          if (!id) continue
          const key = `${group.providerId}:${group.source}:${id}`
          if (seen.has(key)) continue
          seen.add(key)
          refs.push({
            provider: group.providerId,
            model: id,
            source: group.source,
          })
        }
      }
      return refs
    }

    const catalogSignature = () => (
      catalogRefs().map(item => `${item.provider}:${item.source ?? ''}:${item.model}`).join('|')
    )

    const cards = (): EvalSuiteBoard[] => {
      if (s.board?.all && s.board.all.length > 0) return s.board.all
      return (s.board?.suites ?? []).map(suite => ({
        suite,
        models: suite.id === s.board?.selected ? (s.board.models ?? []) : [],
      }))
    }

    const running = () => (
      s.board?.progress?.state === 'running' || s.board?.progress?.state === 'stopping'
    )
    const progress = () => s.board?.progress ?? null

    function focusedRow(models: EvalBoardModel[], suiteId: string) {
      const key = parsePickerSelection(s.suiteModel[suiteId] ?? '')
      if (!key) return null
      return models.find(row => (
        row.model.provider === key.providerId
        && row.model.model === key.model
        && (!key.source || !row.model.source || row.model.source === key.source)
        && row.score != null
      )) ?? null
    }

    function suiteBusy(suiteId: string) {
      return running() && progress()?.suite === suiteId
    }

    function suiteError(suiteId: string) {
      const current = progress()
      if (current?.suite === suiteId && current.error && !suiteBusy(suiteId)) {
        return current.error
      }
      return ''
    }

    function sparkPoints(runs?: number[]) {
      if (!runs || runs.length < 2) return null
      const w = 120
      const h = 28
      const min = Math.min(...runs)
      const max = Math.max(...runs)
      const span = Math.max(1, max - min)
      const dots = runs.map((value, index) => ({
        x: (index / (runs.length - 1)) * w,
        y: h - 3 - ((value - min) / span) * (h - 6),
      }))
      return {
        line: dots.map(dot => `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' '),
        dots,
      }
    }

    function chartFor(models: EvalBoardModel[], suiteId: string) {
      const width = 640
      const height = 200
      const pad = { l: 36, r: 12, t: 16, b: 28 }
      const innerW = width - pad.l - pad.r
      const innerH = height - pad.t - pad.b
      const x = (index: number, count: number) => (
        count <= 1 ? pad.l : pad.l + (index / (count - 1)) * innerW
      )
      const y = (value: number) => pad.t + innerH * (1 - value / 100)
      const selection = parsePickerSelection(s.suiteModel[suiteId] ?? '')
      const drawn = models.filter(row => (row.curve?.length ?? 0) > 0 || row.score != null)
      const series = drawn.map(row => {
        const curve = (row.curve && row.curve.length > 0) ? row.curve : (row.score != null ? [row.score] : [])
        const dots = curve.map((value, index) => ({
          x: Number(x(index, Math.max(curve.length, 1)).toFixed(1)),
          y: Number(y(value).toFixed(1)),
        }))
        return {
          key: `${row.model.provider}::${row.model.model}`,
          points: dots.map(dot => `${dot.x},${dot.y}`).join(' '),
          dots,
          selected: selection?.providerId === row.model.provider && selection.model === row.model.model,
        }
      })
      return {
        width,
        height,
        pad,
        series,
        ticks: [
          { label: t('易', 'Easy'), x: x(0, 2), y: height - 8 },
          { label: t('难', 'Hard'), x: x(1, 2), y: height - 8 },
        ],
        grid: [0, 25, 50, 75, 100].map(value => ({
          value,
          y: y(value),
          x1: pad.l,
          x2: width - pad.r,
        })),
      }
    }

    const current = () => {
      const card = cards().find(item => item.suite.id === s.selectedSuite) ?? cards()[0]
      if (!card) {
        return {
          suite: { id: s.selectedSuite, name: s.selectedSuite, purpose: '', runnable: false, taskN: 0 },
          models: [] as EvalBoardModel[],
          focused: null as ReturnType<typeof focusedRow>,
          spark: null as ReturnType<typeof sparkPoints>,
          chart: chartFor([], s.selectedSuite),
          modelKey: s.suiteModel[s.selectedSuite] ?? '',
          modelId: parsePickerSelection(s.suiteModel[s.selectedSuite] ?? '')?.model ?? '',
          selection: parsePickerSelection(s.suiteModel[s.selectedSuite] ?? ''),
          busy: false,
          error: '',
        }
      }
      const focused = focusedRow(card.models, card.suite.id)
      return {
        ...card,
        focused,
        spark: sparkPoints(focused?.runs),
        chart: chartFor(card.models, card.suite.id),
        modelKey: s.suiteModel[card.suite.id] ?? '',
        modelId: parsePickerSelection(s.suiteModel[card.suite.id] ?? '')?.model ?? '',
        selection: parsePickerSelection(s.suiteModel[card.suite.id] ?? ''),
        busy: suiteBusy(card.suite.id),
        error: suiteError(card.suite.id),
      }
    }

    function applyPickerFallback() {
      const groups = pickerGroups()
      const active = s.settingsRef?.active_model
      const match = groups.find(group => group.models.includes(active ?? ''))
      const first = groups[0]
      const fallback = match && active
        ? encodePickerSelection(match.providerId, active, match.source)
        : first?.models[0]
          ? encodePickerSelection(first.providerId, first.models[0], first.source)
          : ''
      if (!fallback) return
      const next = { ...s.suiteModel }
      const ids = cards().length > 0
        ? cards().map(item => item.suite.id)
        : ['cybench', 'sec-bench', 'autopen']
      let changed = false
      for (const id of ids) {
        if (!next[id]) {
          next[id] = fallback
          changed = true
        }
      }
      if (changed) s.suiteModel = next
    }

    function syncCatalogSignature() {
      const next = catalogSignature()
      if (next === lastCatalogSignature) return
      lastCatalogSignature = next
      void refreshBoard()
    }

    async function refreshBoard() {
      if (!hasDesktopRuntime()) {
        s.error = ''
        return
      }
      const request = ++boardRequest
      try {
        const next = await invokeCommand<EvalBoardSnapshot>('get_eval_board', {
          models: catalogRefs(),
        })
        if (request !== boardRequest) return
        s.board = next
        s.error = next.progress?.error ?? ''
      } catch (reason) {
        if (request !== boardRequest) return
        if (!isMissingDesktopRuntime(reason)) {
          s.error = String(reason instanceof Error ? reason.message : reason)
        }
      }
    }

    async function startCurrent(suiteId: string) {
      const selection = parsePickerSelection(s.suiteModel[suiteId] ?? '')
      const card = cards().find(item => item.suite.id === suiteId)
      if (!selection || !card?.suite.runnable) return
      s.error = ''
      try {
        s.board = await invokeCommand<EvalBoardSnapshot>('start_eval_run', {
          suite: suiteId,
          provider: selection.providerId,
          model: selection.model,
          source: selection.source,
        })
      } catch (reason) {
        s.error = String(reason instanceof Error ? reason.message : reason)
      }
    }

    async function startAll(suiteId: string) {
      const models = catalogRefs()
      const first = models[0]
      const card = cards().find(item => item.suite.id === suiteId)
      if (!first || !card?.suite.runnable) return
      s.error = ''
      try {
        s.board = await invokeCommand<EvalBoardSnapshot>('start_eval_run', {
          suite: suiteId,
          provider: first.provider,
          model: first.model,
          source: first.source,
          models,
        })
      } catch (reason) {
        s.error = String(reason instanceof Error ? reason.message : reason)
      }
    }

    async function stopRun() {
      try {
        s.board = await invokeCommand<EvalBoardSnapshot>('stop_eval_run')
      } catch (reason) {
        s.error = String(reason instanceof Error ? reason.message : reason)
      }
    }

    function setSuiteModel(suiteId: string, value: string) {
      s.suiteModel = { ...s.suiteModel, [suiteId]: value }
    }

    function modelGroup(ref: EvalModelRef) {
      return pickerGroups().find(item => (
        item.providerId === ref.provider
        && item.models.includes(ref.model)
        && (ref.source ? item.source === ref.source : true)
      ))
    }

    function modelLabel(ref: EvalModelRef) {
      const group = modelGroup(ref)
      if (!group) return ref.model
      return pickerModelLabel(group, ref.model)
    }

    function modelServiceLabel(ref: EvalModelRef) {
      return modelGroup(ref)?.label ?? ''
    }

    function selectRow(suiteId: string, row: EvalBoardModel) {
      const group = pickerGroups().find(item => (
        item.providerId === row.model.provider
        && item.models.includes(row.model.model)
        && (!row.model.source || item.source === row.model.source)
      ))
      if (!group) return
      setSuiteModel(suiteId, encodePickerSelection(group.providerId, row.model.model, group.source))
    }

    function suiteScore(id: string) {
      const key = parsePickerSelection(s.suiteModel[id] ?? '')
      const card = cards().find(item => item.suite.id === id)
      if (!key || !card) return undefined
      return card.models.find(row => (
        row.model.provider === key.providerId && row.model.model === key.model
      ))?.score ?? undefined
    }

    const activitySuiteName = () => (
      cards().find(item => item.suite.id === progress()?.suite)?.suite.name ?? ''
    )

    function start() {
      started = true
      applyPickerFallback()
      lastCatalogSignature = catalogSignature()
      void refreshBoard()
      stopCatalog = modelCatalogStore.subscribe(() => {
        applyPickerFallback()
        syncCatalogSignature()
      })
      void listenEvent<EvalBoardSnapshot>('eval-progress', event => {
        const payload = event.payload
        s.error = payload.progress?.error ?? ''
        s.board = payload
      }).then(stop => { unlisten = stop })
      elapsedTimer = setInterval(() => {
        if (!s.board?.progress || s.board.progress.state === 'idle') return
        s.board = {
          ...s.board,
          progress: {
            ...s.board.progress,
            elapsedMs: s.board.progress.elapsedMs + 1000,
          },
        }
      }, 1000)
    }

    function stop() {
      started = false
      unlisten?.()
      stopCatalog?.()
      if (elapsedTimer) clearInterval(elapsedTimer)
    }

    return {
      store,
      s,
      pickerGroups,
      pickerModelLabel,
      cards,
      current,
      running,
      progress,
      catalogRefs,
      activitySuiteName,
      startCurrent,
      startAll,
      stopRun,
      setSuiteModel,
      modelLabel,
      modelServiceLabel,
      selectRow,
      suiteBusy,
      suiteScore,
      start,
      stop,
    }
  })

  useStore(modelCatalogStore)
  store.s.settingsRef = settings

  const pickerGroups = store.pickerGroups()
  const searchablePickerGroups: SearchableModelGroup[] = pickerGroups.map(group => ({
    key: group.key,
    label: group.label,
    models: group.models.map(model => ({
      value: encodePickerSelection(group.providerId, model, group.source),
      label: store.pickerModelLabel(group, model),
      model,
    })),
  }))
  const selectedSuite = store.s.selectedSuite
  const cards = store.cards()
  const current = store.current()
  const running = store.running()
  const progress = store.progress()
  const catalogRefs = store.catalogRefs()
  const activityOpen = store.s.activityOpen
  const error = store.s.error
  const activitySuiteName = store.activitySuiteName()

  function iconFor(id: string) {
    if (id === 'cybench') return Flag
    if (id === 'sec-bench') return Bug
    return FlaskConical
  }

  function clock(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  function remainLabel(ms?: number) {
    if (!ms || ms < 8000) return ''
    if (ms >= 60_000) {
      const minutes = Math.max(1, Math.round(ms / 60_000))
      return t(`大约 ${minutes} 分钟`, `About ${minutes} min`)
    }
    const seconds = Math.round(ms / 1000)
    return t(`大约 ${seconds} 秒`, `About ${seconds} s`)
  }

  return (
    <div className="flex flex-col gap-6">
      {error && !running ? <p className="text-xs text-destructive">{error}</p> : null}

      <SettingsSection title={t('套件', 'Suites')}>
        {cards.map((item, index) => {
          const Icon = iconFor(item.suite.id)
          const selected = item.suite.id === selectedSuite
          const score = store.suiteScore(item.suite.id)
          return (
            <SettingsRow
              key={item.suite.id}
              label={item.suite.name}
              description={item.suite.purpose}
              divider={index < cards.length - 1}
              className={selected ? 'bg-muted/40' : 'cursor-pointer'}
              onClick={() => { store.s.selectedSuite = item.suite.id }}
              trailing={(
                <>
                  {score != null ? <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{score}</span> : null}
                  <Icon className="size-4 text-muted-foreground" />
                </>
              )}
            />
          )
        })}
      </SettingsSection>

      <SettingsSection
        title={current.suite.name}
        actions={!current.busy ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={running || !current.suite.runnable || catalogRefs.length === 0}
            onClick={() => void store.startAll(current.suite.id)}
          >
            {t('全部测一遍', 'Run all')}
          </Button>
        ) : null}
      >
        <SettingsRow
          label={t('模型', 'Model')}
          description={current.error || (current.focused?.score != null
            ? `${current.focused.score} · ${current.focused.solved} / ${current.focused.total}`
            : current.suite.purpose)}
          trailing={(
            <>
              <SearchableModelPicker
                value={current.modelKey}
                triggerClassName="settings-control h-7 px-2"
                ariaLabel={t(`${current.suite.name} 模型`, `${current.suite.name} model`)}
                align="end"
                trigger={(
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ModelVendorIcon model={current.modelId} label={current.modelId} />
                    <span className="min-w-0 truncate">
                      {current.selection
                        ? store.modelLabel({ provider: current.selection.providerId, model: current.selection.model, source: current.selection.source })
                        : ''}
                    </span>
                  </span>
                )}
                groups={searchablePickerGroups}
                onChange={value => store.setSuiteModel(current.suite.id, value)}
              />
              {!current.busy ? (
                <Button
                  size="sm"
                  disabled={!current.suite.runnable || !current.modelKey || running}
                  onClick={() => void store.startCurrent(current.suite.id)}
                >
                  {t('开始', 'Start')}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void store.stopRun()}>
                  <Square className="size-3.5" />
                  {t('停止', 'Stop')}
                </Button>
              )}
            </>
          )}
        />
        {current.busy && progress ? (
          <SettingsRow
            label={t('进行中', 'Running')}
            description={[progress.summary || progress.taskName, clock(progress.elapsedMs), remainLabel(progress.remainMs)].filter(Boolean).join(' · ')}
            divider={current.models.length > 0}
            trailing={(
              <Button variant="ghost" size="sm" onClick={() => { store.s.activityOpen = true }}>
                {t('详情', 'Details')}
              </Button>
            )}
          />
        ) : null}
        {current.models.map((row, index) => (
          <SettingsRow
            key={`${row.model.provider}:${row.model.source ?? ''}:${row.model.model}`}
            label={store.modelLabel(row.model)}
            description={store.modelServiceLabel(row.model)}
            divider={index < current.models.length - 1}
            className={current.modelId === row.model.model ? 'bg-muted/40' : 'cursor-pointer'}
            onClick={() => store.selectRow(current.suite.id, row)}
            trailing={(
              <span className="w-10 text-right text-sm tabular-nums">{row.score ?? ''}</span>
            )}
          />
        ))}
      </SettingsSection>

      <Dialog open={activityOpen} onOpenChange={open => { store.s.activityOpen = open }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>{activitySuiteName}</DialogTitle>
          {progress ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {clock(progress.elapsedMs)}
              {remainLabel(progress.remainMs) ? ` · ${remainLabel(progress.remainMs)}` : null}
              {progress.taskName ? ` · ${progress.taskName}` : null}
              {progress.taskTotal ? ` · ${progress.taskIndex} / ${progress.taskTotal}` : null}
            </p>
          ) : null}
          <ol className="mt-4 space-y-2">
            {(progress?.steps ?? []).map(step => (
              <li key={step.id || step.summary} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center gap-2 text-body">
                  {step.running ? <AkLoadingMark label={t('进行中', 'Running')} /> : null}
                  <span className="min-w-0 flex-1 truncate">{step.summary}</span>
                  {step.durationMs ? (
                    <span className="text-caption tabular-nums text-muted-foreground">
                      {t(`${Math.round(step.durationMs / 1000)} 秒`, `${Math.round(step.durationMs / 1000)} s`)}
                    </span>
                  ) : null}
                </div>
                {step.detail ? (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-caption text-muted-foreground">{step.detail}</pre>
                ) : null}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  )
}
