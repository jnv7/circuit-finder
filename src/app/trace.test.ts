import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { Point } from '../geometry/types'
import { DEV_SAMPLE_M, routeDeviation, routeLengthM, routeStats } from './trace'

// A square ring, 400 m on a side, centred on the origin.
const ring: Point[] = [
  [-200, -200],
  [200, -200],
  [200, 200],
  [-200, 200],
]

/** The ring traced as an open route: all four edges, back to the start. */
const fullLoop = (inset = 0): Point[] => {
  const r = 200 + inset
  return [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
    [-r, -r],
  ]
}

describe('routeLengthM', () => {
  it('sums the open-polyline segments', () => {
    expect(routeLengthM([[0, 0], [3, 0], [3, 4]])).toBe(7)
  })
})

describe('routeDeviation', () => {
  it('is ~0 for a route laid exactly on the ring', () => {
    const { meanM, maxM } = routeDeviation(fullLoop(), ring)
    expect(maxM).toBeLessThan(1)
    expect(meanM).toBeLessThan(1)
  })

  it('tracks a constant outward offset', () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 60 }), (d) => {
        const { meanM, maxM } = routeDeviation(fullLoop(d), ring, { sampleM: 5 })
        // Edges sit d out; corners up to d*sqrt2. Mean lands near d.
        expect(maxM).toBeGreaterThanOrEqual(d - 1)
        expect(maxM).toBeLessThan(d * 1.6 + 2)
        expect(Math.abs(meanM - d)).toBeLessThan(d * 0.5 + 2)
      }),
      { numRuns: 20 },
    )
  })

  it('flags a route that only covers part of the shape via the ring→route direction', () => {
    // Just the bottom edge: route samples are all on the ring, but the far side
    // of the ring is ~400 m from anything the route touches.
    const route: Point[] = [
      [-200, -200],
      [200, -200],
    ]
    const { maxM } = routeDeviation(route, ring)
    expect(maxM).toBeGreaterThan(350)
  })
})

describe('routeStats', () => {
  it('returns null for an empty or single-point route', () => {
    expect(routeStats([], ring)).toBeNull()
    expect(routeStats([[0, 0]], ring)).toBeNull()
  })

  it('returns null for a zero-length route', () => {
    expect(routeStats([[5, 5], [5, 5]], ring)).toBeNull()
  })

  it('combines length and deviation for a route on the ring', () => {
    const stats = routeStats(fullLoop(), ring)!
    expect(stats.lengthM).toBeCloseTo(1600, 5)
    expect(stats.maxDeviationM).toBeLessThan(DEV_SAMPLE_M)
  })
})
