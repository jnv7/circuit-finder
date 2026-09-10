// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { makeSavedPlacement } from '../placements'
import { STORAGE_KEY } from './storage'
import { LEVELS, proximityColor } from './proximity'
import { createMapApp } from './map'

// Leaflet reads element sizes off the container; jsdom reports 0 for all of
// them, which is enough for it to build the map and the SVG overlay but we give
// it a nominal size so layout maths stay finite.
beforeAll(() => {
  for (const prop of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 800 })
  }
})

beforeEach(() => {
  localStorage.clear()
})

const circuits = loadMetricCircuits()
const rampColors = new Set(
  Array.from({ length: LEVELS }, (_, q) => proximityColor((q + 0.5) / LEVELS)),
)

const mount = () => {
  const container = document.createElement('div')
  document.body.append(container)
  return container
}
const panel = (container: HTMLElement) => container.querySelector('.panel') as HTMLElement
const click = (container: HTMLElement, role: string) =>
  panel(container).querySelector(`[data-role="${role}"]`)!.dispatchEvent(new Event('click'))

describe('createMapApp', () => {
  it('mounts the map with a street layer and coloured centreline segments, and tears down cleanly', () => {
    const container = document.createElement('div')
    document.body.append(container)

    const app = createMapApp(container, circuits)

    expect(container.querySelector('.leaflet-container')).not.toBeNull()
    expect(container.querySelector('.rotate-handle')).not.toBeNull()

    const strokes = [...container.querySelectorAll('svg path')].map((p) => p.getAttribute('stroke'))
    // The faint grey street layer.
    expect(strokes).toContain('#8a8a8a')
    // At least one centreline segment drawn in a ramp colour.
    expect(strokes.some((s) => s !== null && rampColors.has(s))).toBe(true)

    expect(() => app.destroy()).not.toThrow()
    expect(container.querySelector('.leaflet-container')).toBeNull()
    expect(container.childNodes.length).toBe(0)

    container.remove()
  })
})

describe('createMapApp — saved placements', () => {
  it('Save writes the store and the panel then offers Revert', () => {
    const container = mount()
    const app = createMapApp(container, circuits)

    expect(panel(container).textContent).toContain('Not saved yet')
    click(container, 'save')

    const raw = localStorage.getItem(STORAGE_KEY)!
    expect(JSON.parse(raw)).toHaveProperty(circuits[0]!.id)
    expect(panel(container).textContent).toContain('Saved ')
    expect(panel(container).querySelector('[data-role="revert"]')).not.toBeNull()

    app.destroy()
    container.remove()
  })

  it('Revert restores the saved placement after an edit', () => {
    const container = mount()
    const app = createMapApp(container, circuits)

    click(container, 'save') // saved at scale 1
    const scale = panel(container).querySelector<HTMLInputElement>('[data-role="scale"]')!
    scale.value = '2.5'
    scale.dispatchEvent(new Event('change'))

    click(container, 'revert')
    expect(panel(container).querySelector<HTMLInputElement>('[data-role="scale"]')!.value).toBe('1')

    app.destroy()
    container.remove()
  })

  it('opens at a pre-seeded saved placement for the initial circuit', () => {
    const saved = makeSavedPlacement(
      circuits[0]!.id,
      { anchor: [-8.6, 41.16], rotationRad: 0, scale: 2 },
      new Date(),
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [circuits[0]!.id]: saved }))

    const container = mount()
    const app = createMapApp(container, circuits)

    // The saved placement was applied, so state matches it: no unsaved changes,
    // hence no preview toggle, and the scale input reflects the stored value.
    expect(panel(container).textContent).toContain('Saved ')
    expect(panel(container).querySelector('[data-role="preview-saved"]')).toBeNull()
    expect(panel(container).querySelector<HTMLInputElement>('[data-role="scale"]')!.value).toBe('2')

    app.destroy()
    container.remove()
  })
})
