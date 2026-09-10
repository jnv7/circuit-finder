import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { Point } from './geometry/types'
import { distanceToSegment } from './geometry/nearest'
import {
  buildStreetIndex,
  loadStreetNetwork,
  validateStreetNetwork,
  type Street,
} from './streets'

// A minimal well-formed encoded network: one 3-point way on the grid.
function validDoc(): unknown {
  return {
    bbox: [-8.688, 41.135, -8.575, 41.183],
    grid: 1e-5,
    attribution: {
      source: 'OpenStreetMap contributors',
      license: 'ODbL 1.0',
      url: 'https://www.openstreetmap.org/copyright',
      retrieved: '2026-09-10',
    },
    ways: [[100, 100, 20, 0, 0, 20]],
  }
}

describe('validateStreetNetwork', () => {
  it('accepts a well-formed document and decodes its ways', () => {
    const { bbox, ways } = validateStreetNetwork(validDoc())
    expect(bbox).toEqual([-8.688, 41.135, -8.575, 41.183])
    expect(ways).toHaveLength(1)
    expect(ways[0]).toHaveLength(3)
    expect(ways[0]![0]![0]).toBeCloseTo(-8.688 + 100 * 1e-5)
    expect(ways[0]![2]![1]).toBeCloseTo(41.135 + 120 * 1e-5)
  })

  it('rejects each malformed shape', () => {
    const bad: Array<[string, (d: Record<string, unknown>) => void]> = [
      ['not an object', () => {}],
      ['missing bbox', (d) => delete d['bbox']],
      ['bbox not four numbers', (d) => (d['bbox'] = [1, 2, 3])],
      ['west >= east', (d) => (d['bbox'] = [10, 41.133, 5, 41.185])],
      ['south >= north', (d) => (d['bbox'] = [-8.67, 50, -8.565, 40])],
      ['grid missing', (d) => delete d['grid']],
      ['grid negative', (d) => (d['grid'] = -1)],
      ['attribution missing', (d) => delete d['attribution']],
      ['attribution incomplete', (d) => (d['attribution'] = { source: 'x' })],
      ['ways empty', (d) => (d['ways'] = [])],
      ['way too short', (d) => (d['ways'] = [[1, 2]])],
      ['way odd length', (d) => (d['ways'] = [[1, 2, 3, 4, 5]])],
      ['way non-integer', (d) => (d['ways'] = [[1.5, 2, 3, 4]])],
      ['way point outside bbox', (d) => (d['ways'] = [[100, 100, 100000, 0]])],
      ['way repeated point', (d) => (d['ways'] = [[100, 100, 0, 0]])],
    ]
    for (const [label, mutate] of bad) {
      const doc = label === 'not an object' ? null : (validDoc() as Record<string, unknown>)
      if (doc) mutate(doc)
      expect(() => validateStreetNetwork(doc), label).toThrow()
    }
  })
})

describe('loadStreetNetwork (bundled data)', () => {
  const network = loadStreetNetwork()

  it('loads and looks sane', () => {
    expect(network.ways.length).toBeGreaterThan(5000)
    expect(network.ways.length).toBeLessThan(60000)
    const vertices = network.ways.reduce((n, w) => n + w.length, 0)
    expect(vertices).toBeGreaterThan(20000)
    expect(vertices).toBeLessThan(200000)
    for (const way of network.ways) expect(way.length).toBeGreaterThanOrEqual(2)
  })

  it('has OSM/ODbL attribution', () => {
    expect(network.attribution.source).toMatch(/OpenStreetMap/)
    expect(network.attribution.license).toMatch(/ODbL/)
  })
})

describe('buildStreetIndex', () => {
  const ways: Street[] = [
    [[0, 0], [100, 0], [100, 100]],
    [[-50, 30], [-50, -30]],
    [[200, 200], [260, 240], [300, 200]],
  ]
  const allSegments: Array<[Point, Point]> = []
  for (const w of ways) for (let i = 1; i < w.length; i++) allSegments.push([w[i - 1]!, w[i]!])

  const bruteNearest = (p: Point, maxM: number): number => {
    let best = maxM
    for (const [a, b] of allSegments) best = Math.min(best, distanceToSegment(p, a, b))
    return best
  }

  it('agrees with a brute-force scan on random points', () => {
    const index = buildStreetIndex(ways, 50)
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 400, noNaN: true }),
        fc.double({ min: -200, max: 400, noNaN: true }),
        (x, y) => {
          const p: Point = [x, y]
          expect(index.nearestDistanceM(p, 1000)).toBeCloseTo(bruteNearest(p, 1000), 6)
        },
      ),
      { seed: 42, numRuns: 500 },
    )
  })

  it('honours the maxM cap', () => {
    const index = buildStreetIndex(ways, 50)
    const p: Point = [130, 0] // ~30 m from the nearest segment
    expect(index.nearestDistanceM(p, 1000)).toBeCloseTo(30, 6)
    expect(index.nearestDistanceM(p, 5)).toBe(5)
  })

  it('returns exactly maxM for a point far from everything', () => {
    const index = buildStreetIndex(ways, 50)
    expect(index.nearestDistanceM([100000, 100000], 25)).toBe(25)
  })
})
