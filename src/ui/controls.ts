// The controls panel: a circuit picker, a scale multiplier, the live readout,
// and the street-proximity legend + toggle. `renderControls` is a pure string
// builder (testable with no DOM); `bind` wires the events on a rendered root.
import type { MetricCircuit } from '../circuits'
import { formatDistance, readout } from '../app/overlay'
import { proximityColor } from '../app/proximity'
import { MAX_SCALE, MIN_SCALE } from '../app/state'

export type ControlsView = {
  circuits: readonly MetricCircuit[]
  selectedId: string
  scale: number
  showStreets: boolean
}

export type ControlsHandlers = {
  onSelectCircuit(id: string): void
  onScaleChange(scale: number): void
  onToggleStreets(show: boolean): void
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

  select?.addEventListener('change', onSelect)
  scale?.addEventListener('change', onScale)
  scale?.addEventListener('input', onScale)
  streets?.addEventListener('change', onStreets)

  return () => {
    select?.removeEventListener('change', onSelect)
    scale?.removeEventListener('change', onScale)
    scale?.removeEventListener('input', onScale)
    streets?.removeEventListener('change', onStreets)
  }
}
