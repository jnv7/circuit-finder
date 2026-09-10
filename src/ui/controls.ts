// The controls panel: a circuit picker, a scale multiplier, the live readout,
// and the street-proximity legend + toggle. `renderControls` is a pure string
// builder (testable with no DOM); `bind` wires the events on a rendered root.
import type { MetricCircuit } from '../circuits'
import type { SavedPlacement } from '../placements'
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
  /** Reference time for the "Saved …" relative label. Defaults to now. */
  now?: Date
}

export type ControlsHandlers = {
  onSelectCircuit(id: string): void
  onScaleChange(scale: number): void
  onToggleStreets(show: boolean): void
  onSave(): void
  onRevertToSaved(): void
  onDeleteSaved(): void
  onTogglePreviewSaved(show: boolean): void
}

export type ReadoutValues = {
  lapM: number
  straightM: number
  nearFraction: number
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
}

/** Attach change listeners. Returns a disposer that removes them. */
export function bind(root: ParentNode, handlers: ControlsHandlers): () => void {
  const select = root.querySelector<HTMLSelectElement>('[data-role="circuit"]')
  const scale = root.querySelector<HTMLInputElement>('[data-role="scale"]')
  const streets = root.querySelector<HTMLInputElement>('[data-role="streets"]')
  const save = root.querySelector<HTMLButtonElement>('[data-role="save"]')
  const revert = root.querySelector<HTMLButtonElement>('[data-role="revert"]')
  const deleteSaved = root.querySelector<HTMLButtonElement>('[data-role="delete-saved"]')
  const preview = root.querySelector<HTMLInputElement>('[data-role="preview-saved"]')

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
  const onSave = (): void => handlers.onSave()
  const onRevert = (): void => handlers.onRevertToSaved()
  const onDelete = (): void => handlers.onDeleteSaved()
  const onPreview = (): void => {
    if (preview) handlers.onTogglePreviewSaved(preview.checked)
  }

  select?.addEventListener('change', onSelect)
  scale?.addEventListener('change', onScale)
  scale?.addEventListener('input', onScale)
  streets?.addEventListener('change', onStreets)
  save?.addEventListener('click', onSave)
  revert?.addEventListener('click', onRevert)
  deleteSaved?.addEventListener('click', onDelete)
  preview?.addEventListener('change', onPreview)

  return () => {
    select?.removeEventListener('change', onSelect)
    scale?.removeEventListener('change', onScale)
    scale?.removeEventListener('input', onScale)
    streets?.removeEventListener('change', onStreets)
    save?.removeEventListener('click', onSave)
    revert?.removeEventListener('click', onRevert)
    deleteSaved?.removeEventListener('click', onDelete)
    preview?.removeEventListener('change', onPreview)
  }
}
