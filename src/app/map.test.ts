// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { loadMetricCircuits } from '../circuits'
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

describe('createMapApp', () => {
  it('mounts a Leaflet map with a centreline polyline and tears down cleanly', () => {
    const container = document.createElement('div')
    document.body.append(container)

    const app = createMapApp(container, circuits)

    expect(container.querySelector('.leaflet-container')).not.toBeNull()
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThanOrEqual(2) // fat drag target + thin centreline
    expect(container.querySelector('.rotate-handle')).not.toBeNull()

    expect(() => app.destroy()).not.toThrow()
    expect(container.querySelector('.leaflet-container')).toBeNull()
    expect(container.childNodes.length).toBe(0)

    container.remove()
  })
})
