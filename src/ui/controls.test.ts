// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { formatDistance, readout } from '../app/overlay'
import { bind, renderControls, updateReadout } from './controls'

const circuits = loadMetricCircuits()

describe('renderControls', () => {
  it('renders one option per circuit, marking the selected one', () => {
    const html = renderControls({ circuits, selectedId: circuits[1]!.id, scale: 1 })
    for (const c of circuits) {
      expect(html).toContain(`<option value="${c.id}"`)
      expect(html).toContain(`>${c.name}</option>`)
    }
    expect(html).toContain(`value="${circuits[1]!.id}" selected`)
  })

  it('shows the formatted readout for the selected circuit and scale', () => {
    const circuit = circuits[0]!
    const html = renderControls({ circuits, selectedId: circuit.id, scale: 2 })
    const { lapM, straightM } = readout(circuit, 2)
    expect(html).toContain(formatDistance(lapM))
    expect(html).toContain(formatDistance(straightM))
  })
})

describe('bind', () => {
  it('calls the handlers on change', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls({ circuits, selectedId: circuits[0]!.id, scale: 1 })
    const onSelectCircuit = vi.fn()
    const onScaleChange = vi.fn()
    const dispose = bind(root, { onSelectCircuit, onScaleChange })

    const select = root.querySelector<HTMLSelectElement>('[data-role="circuit"]')!
    select.value = circuits[2]!.id
    select.dispatchEvent(new Event('change'))
    expect(onSelectCircuit).toHaveBeenCalledWith(circuits[2]!.id)

    const scale = root.querySelector<HTMLInputElement>('[data-role="scale"]')!
    scale.value = '1.5'
    scale.dispatchEvent(new Event('change'))
    expect(onScaleChange).toHaveBeenCalledWith(1.5)

    dispose()
    select.dispatchEvent(new Event('change'))
    expect(onSelectCircuit).toHaveBeenCalledTimes(1)
  })
})

describe('updateReadout', () => {
  it('rewrites just the readout cells', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls({ circuits, selectedId: circuits[0]!.id, scale: 1 })
    updateReadout(root, 1850, 940)
    expect(root.querySelector('[data-role="lap"]')!.textContent).toBe('1.85 km')
    expect(root.querySelector('[data-role="straight"]')!.textContent).toBe('940 m')
  })
})
