// The controls panel: a circuit picker, a scale multiplier, the live readout,
// and the street-proximity legend + toggle. `renderControls` is a pure string
// builder (testable with no DOM); `bind` wires the events on a rendered root.
import type { MetricCircuit } from '../circuits'
import type { SavedPlacement } from '../placements'
import type { RouteStats } from '../app/trace'
import type { LoopSearchProgress, RoutedSuggestion } from '../match/types'
import { formatDistance, readout } from '../app/overlay'
import { proximityColor } from '../app/proximity'
import { MAX_SCALE, MIN_SCALE } from '../app/state'

export type ControlsView = {
  circuits: readonly MetricCircuit[]
  selectedId: string
  scale: number
  showStreets: boolean
  /** The saved placement for the selected circuit, if any. */
  saved: SavedPlacement | null
  /** The live placement differs from `saved` (or there is no `saved`). */
  hasUnsavedChanges: boolean
  /** The "Preview saved" toggle is on. */
  previewingSaved: boolean
  /** Trace mode is active — map clicks add route vertices. */
  tracing: boolean
  /** Study view is active — the panel is stripped to the route summary. */
  studyView: boolean
  /** Number of vertices in the current route. */
  routePointCount: number
  /** Stats for the current route, or `null` when there is nothing to measure. */
  routeStats: RouteStats | null
  /** Circuit lap length at the current scale, for the route-vs-circuit line. */
  circuitLengthM: number
  /** Suggested-placements section state (Phase 6). */
  suggest: SuggestView
  /** Reference time for the "Saved …" relative label. Defaults to now. */
  now?: Date
}

export type SuggestView = {
  phase: 'idle' | 'running' | 'results'
  progress?: LoopSearchProgress
  suggestions: readonly RoutedSuggestion[]
  /** The row currently previewed on the map, if any. */
  selectedIndex: number | null
}

export type ControlsHandlers = {
  onSelectCircuit(id: string): void
  onScaleChange(scale: number): void
  onToggleStreets(show: boolean): void
  onSave(): void
  onRevertToSaved(): void
  onDeleteSaved(): void
  onTogglePreviewSaved(show: boolean): void
  onToggleTrace(): void
  onUndoRoutePoint(): void
  onClearRoute(): void
  onToggleStudyView(): void
  onSuggest(): void
  onCancelSuggest(): void
  onUseSuggestion(index: number): void
  onPreviewSuggestion(index: number | null): void
  onClearSuggestions(): void
}

export type ReadoutValues = {
  lapM: number
  straightM: number
  nearFraction: number
  routeStats: RouteStats | null
  circuitLengthM: number
}

/** "1.98 km — circuit 2.31 km, −14%". Pure. */
export function formatRouteLength(stats: RouteStats, circuitLengthM: number): string {
  const pct =
    circuitLengthM > 0 ? Math.round(((stats.lengthM - circuitLengthM) / circuitLengthM) * 100) : 0
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±'
  return `${formatDistance(stats.lengthM)} — circuit ${formatDistance(circuitLengthM)}, ${sign}${Math.abs(pct)}%`
}

/** "~45 m avg · 160 m max". Pure. */
export function formatDeviation(stats: RouteStats): string {
  return `~${Math.round(stats.meanDeviationM)} m avg · ${Math.round(stats.maxDeviationM)} m max`
}

/**
 * The label for one suggestion row: a routed loop reads as its real length
 * and deviation from the circuit shape ("simple: false" flagged visibly, not
 * just ranked lower); a best-effort loop (Phase 10, no full loop found) reads
 * as its real length plus how many street gaps it invents and their total
 * length; a fallback (no real attempt at all) keeps Phase 6's coverage-
 * percentage wording, reading clearly as none of the above. Pure.
 */
export function formatSuggestionLabel(s: RoutedSuggestion): string {
  if (s.loop) {
    const distance = formatDistance(s.loop.lengthM)
    const deviation = formatDeviation(s.loop)
    return s.loop.simple
      ? `${distance} closed loop · ${deviation} off shape`
      : `${distance} loop (retraces a street) · ${deviation} off shape`
  }
  if (s.bestEffort) {
    const { lengthM, gapCount, gapLengthM, meanDeviationM } = s.bestEffort
    const distance = formatDistance(lengthM)
    const gaps = `${gapCount} street gap${gapCount === 1 ? '' : 's'} (${formatDistance(gapLengthM)})`
    return `${distance} loop · ${gaps} · ~${Math.round(meanDeviationM)} m off shape`
  }
  const pct = Math.round(Math.max(0, Math.min(1, s.coverageFraction)) * 100)
  return `${pct}% on streets · ~${Math.round(s.meanDeviationM)} m avg`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatNearFraction(nearFraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, nearFraction)) * 100)}%`
}

/** A short relative label for when a placement was saved. Pure. */
export function formatSavedAgo(savedAt: string, now: Date): string {
  const then = Date.parse(savedAt)
  if (Number.isNaN(then)) return 'at an unknown time'
  const secs = Math.max(0, Math.round((now.getTime() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return `on ${new Date(then).toISOString().slice(0, 10)}`
}

const LEGEND_STOPS: ReadonlyArray<[number, string]> = [
  [1, 'on a street'],
  [0.5, 'partly'],
  [0, 'off-street'],
]

/** Render the panel as an HTML string. Pure. */
export function renderControls(view: ControlsView): string {
  if (view.studyView) return renderStudySummary(view)

  const circuit = view.circuits.find((c) => c.id === view.selectedId) ?? view.circuits[0]
  const options = view.circuits
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}"${c.id === view.selectedId ? ' selected' : ''}>` +
        `${escapeHtml(c.name)}</option>`,
    )
    .join('')

  const measures = circuit ? readout(circuit, view.scale) : { lapM: 0, straightM: 0 }

  const legend = LEGEND_STOPS.map(
    ([coverage, label]) =>
      `<li><span class="swatch" style="background:${proximityColor(coverage)}"></span>${label}</li>`,
  ).join('')

  const savedSection = renderSavedSection(view)

  return `
    <div class="controls">
      <label class="control">
        <span>Circuit</span>
        <select data-role="circuit">${options}</select>
      </label>
      ${renderSuggestSection(view)}
      <label class="control">
        <span>Scale ×</span>
        <input
          type="number"
          data-role="scale"
          min="${MIN_SCALE}"
          max="${MAX_SCALE}"
          step="0.05"
          value="${view.scale}"
        />
      </label>
      <dl class="readout">
        <div><dt>Lap length</dt><dd data-role="lap">${formatDistance(measures.lapM)}</dd></div>
        <div><dt>Longest straight</dt><dd data-role="straight">${formatDistance(measures.straightM)}</dd></div>
        <div><dt>Near a street</dt><dd data-role="proximity">–</dd></div>
      </dl>
      <label class="control control--check">
        <input type="checkbox" data-role="streets"${view.showStreets ? ' checked' : ''} />
        <span>Show streets</span>
      </label>
      <ul class="legend">${legend}</ul>
      ${savedSection}
      ${renderRouteSection(view)}
    </div>
  `
}

function routeStatsRows(view: ControlsView): string {
  const s = view.routeStats
  if (!s) return ''
  return `
    <dl class="readout">
      <div><dt>Route length</dt><dd data-role="route-length">${formatRouteLength(
        s,
        view.circuitLengthM,
      )}</dd></div>
      <div><dt>Deviation</dt><dd data-role="route-deviation">${formatDeviation(s)}</dd></div>
    </dl>`
}

/** The "Route" block: the trace toggle, add/undo/clear while tracing, and — once
 *  there is a route — its length/deviation stats and the "Study view" button. */
function renderRouteSection(view: ControlsView): string {
  const { tracing, routePointCount } = view
  const noPoints = routePointCount === 0
  const tracingControls = tracing
    ? `
        <span class="saved__when">${routePointCount} point${routePointCount === 1 ? '' : 's'}</span>
        <div class="saved__actions">
          <button type="button" data-role="undo-point"${noPoints ? ' disabled' : ''}>Undo point</button>
          <button type="button" data-role="clear-route"${noPoints ? ' disabled' : ''}>Clear route</button>
        </div>`
    : ''

  return `
    <div class="saved" data-role="route">
      <div class="saved__row">
        <button type="button" data-role="trace">${tracing ? 'Stop tracing' : 'Trace route'}</button>
      </div>
      ${tracingControls}
      ${routeStatsRows(view)}
      ${view.routeStats ? '<button type="button" data-role="study">Study view</button>' : ''}
    </div>
  `
}

/** The "Suggest placements" block: an opt-in button, then a cancellable
 *  progress bar while the search runs, then a ranked list of starting spots
 *  (hover a row to preview it, "Use this" to drop the circuit there). */
function renderSuggestSection(view: ControlsView): string {
  const { suggest } = view

  if (suggest.phase === 'running') {
    const p = suggest.progress ?? { done: 0, total: 1, phase: 'search' as const }
    const phaseLabel = p.phase === 'route' ? 'Checking routes…' : 'Searching placements…'
    return `
      <div class="suggest" data-role="suggest-panel">
        <p class="suggest__phase" data-role="suggest-phase">${phaseLabel}</p>
        <progress data-role="suggest-progress" value="${p.done}" max="${p.total}"></progress>
        <button type="button" data-role="suggest-cancel">Cancel</button>
      </div>
    `
  }

  if (suggest.phase === 'results') {
    const rows = suggest.suggestions
      .map((s, i) => {
        const selected = suggest.selectedIndex === i ? ' class="suggest__row--selected"' : ''
        return (
          `<li data-suggest-index="${i}"${selected}>` +
          `<span class="suggest__label">${escapeHtml(formatSuggestionLabel(s))}</span>` +
          `<button type="button" data-role="suggest-use" data-suggest-index="${i}">Use this</button>` +
          `</li>`
        )
      })
      .join('')
    const body = suggest.suggestions.length
      ? `<ol class="suggest__list" data-role="suggest-list">${rows}</ol>`
      : '<p class="suggest__empty">No spots found on Porto streets.</p>'
    return `
      <div class="suggest" data-role="suggest-panel">
        ${body}
        <button type="button" data-role="suggest-clear">Dismiss</button>
      </div>
    `
  }

  const disabled = view.previewingSaved || view.tracing ? ' disabled' : ''
  return `
    <div class="suggest" data-role="suggest-panel">
      <button type="button" data-role="suggest"${disabled}>Suggest placements</button>
    </div>
  `
}

/** The stripped-down study view: just the route stats and a way back. */
function renderStudySummary(view: ControlsView): string {
  return `
    <div class="controls study-summary" data-role="study-summary">
      ${routeStatsRows(view)}
      <button type="button" data-role="study-exit">Exit study view</button>
    </div>
  `
}

/** The "Saved placement" block: Save, and — when one exists — its age plus
 *  Revert / Delete and (only with unsaved changes) the Preview toggle. */
function renderSavedSection(view: ControlsView): string {
  const { saved, hasUnsavedChanges, previewingSaved } = view
  const when = saved
    ? `Saved ${formatSavedAgo(saved.savedAt, view.now ?? new Date())}`
    : 'Not saved yet'

  const savedControls = saved
    ? `
        <div class="saved__actions">
          <button type="button" data-role="revert">Revert to saved</button>
          <button type="button" data-role="delete-saved">Delete saved</button>
        </div>
        ${
          hasUnsavedChanges
            ? `<label class="control control--check">
                 <input type="checkbox" data-role="preview-saved"${
                   previewingSaved ? ' checked' : ''
                 } />
                 <span>Preview saved</span>
               </label>`
            : ''
        }`
    : ''

  return `
    <div class="saved" data-role="saved">
      <div class="saved__row">
        <button type="button" data-role="save">Save placement</button>
        <span class="saved__when${saved ? '' : ' saved__when--none'}">${when}</span>
      </div>
      ${savedControls}
    </div>
  `
}

/** Update just the readout values in an already-rendered panel. */
export function updateReadout(root: ParentNode, values: ReadoutValues): void {
  const lap = root.querySelector('[data-role="lap"]')
  const straight = root.querySelector('[data-role="straight"]')
  const proximity = root.querySelector('[data-role="proximity"]')
  if (lap) lap.textContent = formatDistance(values.lapM)
  if (straight) straight.textContent = formatDistance(values.straightM)
  if (proximity) proximity.textContent = formatNearFraction(values.nearFraction)

  const routeLength = root.querySelector('[data-role="route-length"]')
  const routeDeviation = root.querySelector('[data-role="route-deviation"]')
  if (routeLength && values.routeStats) {
    routeLength.textContent = formatRouteLength(values.routeStats, values.circuitLengthM)
  }
  if (routeDeviation && values.routeStats) {
    routeDeviation.textContent = formatDeviation(values.routeStats)
  }
}

/** Attach change listeners. Returns a disposer that removes them. */
export function bind(root: ParentNode, handlers: ControlsHandlers): () => void {
  const select = root.querySelector<HTMLSelectElement>('[data-role="circuit"]')
  const scale = root.querySelector<HTMLInputElement>('[data-role="scale"]')
  const streets = root.querySelector<HTMLInputElement>('[data-role="streets"]')
  const preview = root.querySelector<HTMLInputElement>('[data-role="preview-saved"]')

  const btn = (role: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-role="${role}"]`)
  const clicks: ReadonlyArray<[HTMLButtonElement | null, () => void]> = [
    [btn('save'), handlers.onSave],
    [btn('revert'), handlers.onRevertToSaved],
    [btn('delete-saved'), handlers.onDeleteSaved],
    [btn('trace'), handlers.onToggleTrace],
    [btn('undo-point'), handlers.onUndoRoutePoint],
    [btn('clear-route'), handlers.onClearRoute],
    [btn('study'), handlers.onToggleStudyView],
    [btn('study-exit'), handlers.onToggleStudyView],
    [btn('suggest'), handlers.onSuggest],
    [btn('suggest-cancel'), handlers.onCancelSuggest],
    [btn('suggest-clear'), handlers.onClearSuggestions],
  ]

  // Suggestion rows: "Use this" per row, and hover / focus to preview it.
  const suggestList = root.querySelector<HTMLElement>('[data-role="suggest-list"]')
  const rowEls = [...root.querySelectorAll<HTMLLIElement>('li[data-suggest-index]')]
  const useEls = [...root.querySelectorAll<HTMLButtonElement>('[data-role="suggest-use"]')]
  const rowDisposers: Array<() => void> = []
  for (const el of useEls) {
    const i = Number(el.dataset['suggestIndex'])
    const fn = (): void => handlers.onUseSuggestion(i)
    el.addEventListener('click', fn)
    rowDisposers.push(() => el.removeEventListener('click', fn))
  }
  for (const el of rowEls) {
    const i = Number(el.dataset['suggestIndex'])
    const enter = (): void => handlers.onPreviewSuggestion(i)
    el.addEventListener('mouseenter', enter)
    el.addEventListener('focusin', enter)
    rowDisposers.push(() => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('focusin', enter)
    })
  }
  if (suggestList) {
    const leave = (): void => handlers.onPreviewSuggestion(null)
    suggestList.addEventListener('mouseleave', leave)
    rowDisposers.push(() => suggestList.removeEventListener('mouseleave', leave))
  }

  const onSelect = (): void => {
    if (select) handlers.onSelectCircuit(select.value)
  }
  const onScale = (): void => {
    if (scale) {
      const value = Number(scale.value)
      if (Number.isFinite(value)) handlers.onScaleChange(value)
    }
  }
  const onStreets = (): void => {
    if (streets) handlers.onToggleStreets(streets.checked)
  }
  const onPreview = (): void => {
    if (preview) handlers.onTogglePreviewSaved(preview.checked)
  }

  select?.addEventListener('change', onSelect)
  scale?.addEventListener('change', onScale)
  scale?.addEventListener('input', onScale)
  streets?.addEventListener('change', onStreets)
  preview?.addEventListener('change', onPreview)
  for (const [el, fn] of clicks) el?.addEventListener('click', fn)

  return () => {
    select?.removeEventListener('change', onSelect)
    scale?.removeEventListener('change', onScale)
    scale?.removeEventListener('input', onScale)
    streets?.removeEventListener('change', onStreets)
    preview?.removeEventListener('change', onPreview)
    for (const [el, fn] of clicks) el?.removeEventListener('click', fn)
    for (const dispose of rowDisposers) dispose()
  }
}
