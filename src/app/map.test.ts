// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { makeSavedPlacement } from '../placements'
import { STORAGE_KEY } from './storage'
import { LEVELS, proximityColor } from './proximity'
import { createMapApp } from './map'

// Stub the search generator so the suggest tests are fast and deterministic.
const STUB_SUGGESTIONS = [
  {
    placement: { anchor: [-8.6, 41.165], rotationRad: 0.4, scale: 1 },
    coverageFraction: 0.82,
    meanDeviationM: 21,
    maxDeviationM: 55,
  },
  {
    placement: { anchor: [-8.64, 41.15], rotationRad: -0.3, scale: 1 },
    coverageFraction: 0.61,
    meanDeviationM: 38,
    maxDeviationM: 90,
  },
]
vi.mock('../match/search', () => ({
  searchPlacements: function* () {
    yield { done: 1, total: 2 }
    yield { done: 2, total: 2 }
    return STUB_SUGGESTIONS
  },
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

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
const mapClick = (container: HTMLElement, x: number, y: number) =>
  container
    .querySelector('.leaflet-container')!
    .dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }))
const strokes = (container: HTMLElement) =>
  [...container.querySelectorAll('svg path')].map((p) => p.getAttribute('stroke'))

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

  it('traces a route by clicking, and saves it with the placement', () => {
    const container = mount()
    const app = createMapApp(container, circuits)

    click(container, 'trace')
    mapClick(container, 120, 140)
    mapClick(container, 360, 320)

    const routeStroke = strokes(container).filter((s) => s === '#1565c0')
    expect(routeStroke.length).toBeGreaterThan(0)
    expect(panel(container).textContent).toMatch(/Route length/)

    click(container, 'save')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored[circuits[0]!.id].route).toHaveLength(2)

    app.destroy()
    container.remove()
  })

  it('study view hides the circuit and street layers and strips the panel', () => {
    const container = mount()
    const app = createMapApp(container, circuits)

    click(container, 'trace')
    mapClick(container, 120, 140)
    mapClick(container, 360, 320)
    click(container, 'study')

    expect(strokes(container)).not.toContain('#8a8a8a') // street layer gone
    expect(strokes(container)).toContain('#1565c0') // route kept
    expect(panel(container).querySelector('[data-role="study-summary"]')).not.toBeNull()
    expect(panel(container).querySelector('[data-role="circuit"]')).toBeNull()

    click(container, 'study-exit')
    expect(panel(container).querySelector('[data-role="circuit"]')).not.toBeNull()

    app.destroy()
    container.remove()
  })

  it('suggest → results list → use moves the overlay, clear returns to idle', async () => {
    const container = mount()
    const app = createMapApp(container, circuits)

    const paths = () =>
      [...container.querySelectorAll('svg path')].map((p) => p.getAttribute('d')).join('|')
    const before = paths()

    click(container, 'suggest')
    await flush()

    // The panel now shows the ranked list from the stub.
    expect(panel(container).querySelector('[data-role="suggest-list"]')).not.toBeNull()
    expect(panel(container).textContent).toContain('82% on streets')
    const rows = panel(container).querySelectorAll('[data-role="suggest-use"]')
    expect(rows).toHaveLength(2)

    ;(rows[0] as HTMLButtonElement).dispatchEvent(new Event('click'))
    await flush()

    // Overlay geometry changed and the panel is back to the idle button.
    expect(paths()).not.toBe(before)
    expect(panel(container).querySelector('[data-role="suggest"]')).not.toBeNull()
    expect(panel(container).querySelector('[data-role="suggest-list"]')).toBeNull()

    app.destroy()
    container.remove()
  })

  it('suggest then clear dismisses the list without touching the placement', async () => {
    const container = mount()
    const app = createMapApp(container, circuits)
    const scaleBefore = panel(container).querySelector<HTMLInputElement>('[data-role="scale"]')!.value

    click(container, 'suggest')
    await flush()
    click(container, 'suggest-clear')

    expect(panel(container).querySelector('[data-role="suggest-list"]')).toBeNull()
    expect(panel(container).querySelector('[data-role="suggest"]')).not.toBeNull()
    expect(panel(container).querySelector<HTMLInputElement>('[data-role="scale"]')!.value).toBe(
      scaleBefore,
    )

    app.destroy()
    container.remove()
  })

  it('opens at a pre-seeded saved placement for the initial circuit', () => {
    const saved = makeSavedPlacement(
      circuits[0]!.id,
      { anchor: [-8.6, 41.16], rotationRad: 0, scale: 2 },
      [],
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
