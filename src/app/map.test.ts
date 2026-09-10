// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { loadMetricCircuits } from '../circuits'
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

const circuits = loadMetricCircuits()
const rampColors = new Set(
  Array.from({ length: LEVELS }, (_, q) => proximityColor((q + 0.5) / LEVELS)),
)

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
