import { describe, it, expect } from 'vitest'
import {
  loadCircuits,
  loadMetricCircuits,
  renderCircuitList,
  toMetric,
  validateCircuits,
  type Circuit,
} from './circuits'
import { centroid, pathLength } from './geometry/path'

function makeCircuit(overrides: Partial<Circuit> = {}): Circuit {
  // a ~400 m square ring near Barcelona-Catalunya, 24 points
  const centre: [number, number] = [2.26, 41.57]
  const side = 0.0012
  const ring: [number, number][] = []
  const perSide = 6
  const corners: [number, number][] = [
    [centre[0] - side, centre[1] - side],
    [centre[0] + side, centre[1] - side],
    [centre[0] + side, centre[1] + side],
    [centre[0] - side, centre[1] + side],
  ]
  for (let c = 0; c < 4; c++) {
    const from = corners[c]!
    const to = corners[(c + 1) % 4]!
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide
      ring.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
    }
  }
  return {
    id: 'test',
    name: 'Test Circuit',
    location: { lat: centre[1], lon: centre[0] },
    officialLengthM: 950,
    attribution: {
      source: 'OpenStreetMap contributors',
      license: 'ODbL 1.0',
      url: 'https://example.com/way/1',
      retrieved: '2026-09-09',
    },
    centreline: ring,
    ...overrides,
  }
}

describe('loadCircuits', () => {
  it('returns the three bundled circuits', () => {
    const circuits = loadCircuits()
    expect(circuits.map((c) => c.id)).toEqual(['hungaroring', 'silverstone', 'catalunya'])
  })

  it('round-trips through validateCircuits', () => {
    const circuits = loadCircuits()
    expect(validateCircuits(circuits)).toEqual(circuits)
  })

  it('every bundled circuit has complete attribution', () => {
    for (const c of loadCircuits()) {
      expect(c.attribution.source).toContain('OpenStreetMap')
      expect(c.attribution.license).toMatch(/ODbL/)
      expect(c.attribution.url).toMatch(/^https?:\/\//)
      expect(c.attribution.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('validateCircuits', () => {
  it('accepts a well-formed circuit', () => {
    expect(() => validateCircuits([makeCircuit()])).not.toThrow()
  })

  it('rejects a non-array and an empty array', () => {
    expect(() => validateCircuits({})).toThrow()
    expect(() => validateCircuits([])).toThrow()
  })

  it('rejects a blank name and duplicate ids', () => {
    expect(() => validateCircuits([makeCircuit({ name: '  ' })])).toThrow()
    expect(() => validateCircuits([makeCircuit(), makeCircuit()])).toThrow(/duplicate/)
  })

  it('rejects an out-of-range location', () => {
    expect(() => validateCircuits([makeCircuit({ location: { lat: 100, lon: 0 } })])).toThrow()
  })

  it('rejects a non-positive officialLengthM', () => {
    expect(() => validateCircuits([makeCircuit({ officialLengthM: 0 })])).toThrow()
  })

  it('rejects missing attribution fields', () => {
    const bad = makeCircuit()
    bad.attribution = { ...bad.attribution, url: '' }
    expect(() => validateCircuits([bad])).toThrow(/attribution/)
  })

  it('rejects a centreline that is too short', () => {
    expect(() => validateCircuits([makeCircuit({ centreline: [[0, 0], [1, 1], [2, 0]] })])).toThrow(
      /at least/,
    )
  })

  it('rejects an explicitly closed ring', () => {
    const c = makeCircuit()
    const closed = [...c.centreline, c.centreline[0]!]
    expect(() => validateCircuits([makeCircuit({ centreline: closed })])).toThrow(/open ring/)
  })

  it('rejects a length far from officialLengthM', () => {
    expect(() => validateCircuits([makeCircuit({ officialLengthM: 100_000 })])).toThrow(/within/)
  })
})

describe('toMetric', () => {
  it('projects, centres, and measures each bundled circuit', () => {
    for (const c of loadMetricCircuits()) {
      // the polygon-area centroid of the metric centreline is at the origin
      const [cx, cy] = centroid(c.metricCentreline)
      expect(Math.abs(cx)).toBeLessThan(1e-3)
      expect(Math.abs(cy)).toBeLessThan(1e-3)

      // computed length is within 20% of the published length
      expect(c.lengthM / c.officialLengthM).toBeGreaterThan(0.8)
      expect(c.lengthM / c.officialLengthM).toBeLessThan(1.2)

      // the longest straight is a sane fraction of the lap
      const frac = c.longestStraight.lengthM / c.lengthM
      expect(frac).toBeGreaterThan(0.03)
      expect(frac).toBeLessThan(0.5)
    }
  })

  it('metric length matches a direct projection of the raw centreline', () => {
    const c = toMetric(makeCircuit())
    expect(c.lengthM).toBeCloseTo(pathLength(c.metricCentreline, true), 6)
  })
})

describe('renderCircuitList', () => {
  it('renders one list item per circuit with its name and lap length', () => {
    const circuits = loadMetricCircuits()
    const html = renderCircuitList(circuits)
    expect(html.startsWith('<ul')).toBe(true)
    expect(html.endsWith('</ul>')).toBe(true)
    expect((html.match(/<li/g) ?? []).length).toBe(circuits.length)
    for (const c of circuits) {
      expect(html).toContain(c.name)
      expect(html).toContain('lap ')
      expect(html).toContain('longest straight')
    }
  })
})
