// The controls panel: a circuit picker, a scale multiplier, and the live
// readout. `renderControls` is a pure string builder (testable with no DOM);
// `bind` wires the change events on an already-rendered root.
import type { MetricCircuit } from '../circuits'
import { formatDistance, readout } from '../app/overlay'
import { MAX_SCALE, MIN_SCALE } from '../app/state'

export type ControlsView = {
  circuits: readonly MetricCircuit[]
  selectedId: string
  scale: number
}

export type ControlsHandlers = {
  onSelectCircuit(id: string): void
  onScaleChange(scale: number): void
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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

  const measures = circuit
    ? readout(circuit, view.scale)
    : { lapM: 0, straightM: 0 }

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
      </dl>
    </div>
  `
}

/** Update just the readout values in an already-rendered panel. */
export function updateReadout(root: ParentNode, lapM: number, straightM: number): void {
  const lap = root.querySelector('[data-role="lap"]')
  const straight = root.querySelector('[data-role="straight"]')
  if (lap) lap.textContent = formatDistance(lapM)
  if (straight) straight.textContent = formatDistance(straightM)
}

/** Attach change listeners. Returns a disposer that removes them. */
export function bind(root: ParentNode, handlers: ControlsHandlers): () => void {
  const select = root.querySelector<HTMLSelectElement>('[data-role="circuit"]')
  const scale = root.querySelector<HTMLInputElement>('[data-role="scale"]')

  const onSelect = (): void => {
    if (select) handlers.onSelectCircuit(select.value)
  }
  const onScale = (): void => {
    if (scale) {
      const value = Number(scale.value)
      if (Number.isFinite(value)) handlers.onScaleChange(value)
    }
  }

  select?.addEventListener('change', onSelect)
  scale?.addEventListener('change', onScale)
  scale?.addEventListener('input', onScale)

  return () => {
    select?.removeEventListener('change', onSelect)
    scale?.removeEventListener('change', onScale)
    scale?.removeEventListener('input', onScale)
  }
}
