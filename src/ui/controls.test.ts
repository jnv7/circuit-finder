// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { formatDistance, readout } from '../app/overlay'
import { bind, renderControls, updateReadout } from './controls'

const circuits = loadMetricCircuits()
const view = (over: Partial<Parameters<typeof renderControls>[0]> = {}) => ({
  circuits,
  selectedId: circuits[0]!.id,
  scale: 1,
  showStreets: true,
  ...over,
})

describe('renderControls', () => {
  it('renders one option per circuit, marking the selected one', () => {
    const html = renderControls(view({ selectedId: circuits[1]!.id }))
    for (const c of circuits) {
      expect(html).toContain(`<option value="${c.id}"`)
      expect(html).toContain(`>${c.name}</option>`)
    }
    expect(html).toContain(`value="${circuits[1]!.id}" selected`)
  })

  it('shows the formatted readout for the selected circuit and scale', () => {
    const circuit = circuits[0]!
    const html = renderControls(view({ scale: 2 }))
    const { lapM, straightM } = readout(circuit, 2)
    expect(html).toContain(formatDistance(lapM))
    expect(html).toContain(formatDistance(straightM))
  })

  it('renders the proximity cell, the legend, and a checked streets toggle', () => {
    const html = renderControls(view())
    expect(html).toContain('data-role="proximity"')
    expect(html).toContain('class="legend"')
    expect(html).toContain('on a street')
    expect(html).toContain('off-street')
    expect(html).toContain('data-role="streets"')
    expect(html).toMatch(/data-role="streets"[^>]*checked/)
  })

  it('leaves the streets toggle unchecked when showStreets is false', () => {
    const html = renderControls(view({ showStreets: false }))
    expect(html).not.toMatch(/data-role="streets"[^>]*checked/)
  })
})

describe('bind', () => {
  it('calls the handlers on change', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view())
    const onSelectCircuit = vi.fn()
    const onScaleChange = vi.fn()
    const onToggleStreets = vi.fn()
    const dispose = bind(root, { onSelectCircuit, onScaleChange, onToggleStreets })

    const select = root.querySelector<HTMLSelectElement>('[data-role="circuit"]')!
    select.value = circuits[2]!.id
    select.dispatchEvent(new Event('change'))
    expect(onSelectCircuit).toHaveBeenCalledWith(circuits[2]!.id)

    const scale = root.querySelector<HTMLInputElement>('[data-role="scale"]')!
    scale.value = '1.5'
    scale.dispatchEvent(new Event('change'))
    expect(onScaleChange).toHaveBeenCalledWith(1.5)

    const streets = root.querySelector<HTMLInputElement>('[data-role="streets"]')!
    streets.checked = false
    streets.dispatchEvent(new Event('change'))
    expect(onToggleStreets).toHaveBeenCalledWith(false)

    dispose()
    select.dispatchEvent(new Event('change'))
    expect(onSelectCircuit).toHaveBeenCalledTimes(1)
  })
})

describe('updateReadout', () => {
  it('rewrites just the readout cells, including % near a street', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view())
    updateReadout(root, { lapM: 1850, straightM: 940, nearFraction: 0.42 })
    expect(root.querySelector('[data-role="lap"]')!.textContent).toBe('1.85 km')
    expect(root.querySelector('[data-role="straight"]')!.textContent).toBe('940 m')
    expect(root.querySelector('[data-role="proximity"]')!.textContent).toBe('42%')
  })
})
