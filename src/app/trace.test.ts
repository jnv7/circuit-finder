import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildStreetGraph } from '../graph'
import type { Street } from '../streets'
import type { Point } from '../geometry/types'
import { DEV_SAMPLE_M, expandRouteWithGaps, routeDeviation, routeLengthM, routeStats } from './trace'

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

describe('expandRouteWithGaps', () => {
  // Three streets meeting exactly at the origin (west/north/east spokes).
  const spokes: Street[] = [
    [[0, 0], [-100, 0]],
    [[0, 0], [0, 100]],
    [[0, 0], [100, 0]],
  ]
  const graph = buildStreetGraph(spokes)

  it('concatenates the two routed legs without duplicating the join point', () => {
    const waypoints: Point[] = [[-100, 0], [0, 100], [100, 0]]
    const { points, legs } = expandRouteWithGaps(waypoints, graph)
    expect(points).toEqual([[-100, 0], [0, 0], [0, 100], [0, 0], [100, 0]])
    expect(routeLengthM(points)).toBeCloseTo(400, 6)
    expect(legs).toHaveLength(2)
    expect(legs.every((l) => l.real)).toBe(true)
  })

  it('falls back to a straight line for a waypoint pair in disconnected components', () => {
    const disconnected: Street[] = [
      [[0, 0], [10, 0]],
      [[10000, 10000], [10010, 10000]],
    ]
    const g = buildStreetGraph(disconnected)
    const waypoints: Point[] = [[0, 0], [10000, 10000]]
    const { points, legs } = expandRouteWithGaps(waypoints, g)
    expect(points).toEqual([[0, 0], [10000, 10000]])
    expect(legs).toEqual([{ points: [[0, 0], [10000, 10000]], real: false }])
  })

  it('measures the real routed distance, not the straight-line waypoint distance', () => {
    // West to north: routed via the shared centre is 200 m; the straight
    // line between the two waypoints is only ~141 m.
    const waypoints: Point[] = [[-100, 0], [0, 100]]
    const straightLineM = Math.hypot(100, 100)
    const { points } = expandRouteWithGaps(waypoints, graph)
    expect(routeLengthM(points)).toBeCloseTo(200, 6)
    expect(routeLengthM(points)).toBeGreaterThan(straightLineM + 10)
  })

  it('a disconnected pair among otherwise-connected waypoints produces exactly one gap leg', () => {
    const disconnected: Street[] = [
      [[0, 0], [100, 0]],
      [[10000, 0], [10100, 0]],
    ]
    const g = buildStreetGraph(disconnected)
    const waypoints: Point[] = [[0, 0], [100, 0], [10000, 0], [10100, 0]]
    const { legs } = expandRouteWithGaps(waypoints, g)
    expect(legs).toHaveLength(3)
    expect(legs[0]!.real).toBe(true)
    expect(legs[1]!.real).toBe(false)
    expect(legs[1]!.points).toEqual([[100, 0], [10000, 0]])
    expect(legs[2]!.real).toBe(true)
  })

  it('resolves a waypoint to the street it actually sits on, not a nearer vertex on an unrelated street', () => {
    // A waypoint far out on a long street (90 m from either of its own
    // endpoints) sits only ~13 m, as the crow flies, from a dead-end street's
    // endpoint — closer than either of its own street's endpoints, but on a
    // disconnected street entirely. Resolving by nearest *point on the
    // network* (not nearest vertex) must still recognise it as sitting on
    // mainStreet, the same way a routed suggestion's own dense polyline sits
    // exactly on the streets it was built from — re-resolving it (as
    // "Use this" + the route/deviation readout do) shouldn't silently
    // re-snap it onto an unrelated nearby dead end.
    const mainStreet: Street = [[0, 0], [200, 0]]
    const decoy: Street = [[100, 8], [100, 108]]
    const graph = buildStreetGraph([mainStreet, decoy])
    const waypoints: Point[] = [[90, 0], [110, 0]]
    const { points, legs } = expandRouteWithGaps(waypoints, graph)
    expect(legs).toHaveLength(1)
    expect(legs[0]!.real).toBe(true)
    expect(points.every((p) => p[1] === 0)).toBe(true)
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
