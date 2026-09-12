import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { arbPolygon } from './geometry/testing'
import { pathLength } from './geometry/path'
import type { Point } from './geometry/types'
import { buildStreetGraph, componentLengthsM } from './graph'
import { loadStreetNetwork } from './streets'
import type { Street } from './streets'

describe('buildStreetGraph', () => {
  it('merges two ways sharing an exact endpoint into one node and two edges', () => {
    const ways: Street[] = [
      [[0, 0], [10, 0]],
      [[10, 0], [10, 10]],
    ]
    const graph = buildStreetGraph(ways)
    expect(graph.nodeCount).toBe(3) // (0,0), (10,0) shared, (10,10)

    const shared = graph.nearestNode([10, 0], 0.001)
    expect(shared).not.toBeNull()
    const a = graph.nearestNode([0, 0], 0.001)!
    const b = graph.nearestNode([10, 10], 0.001)!
    const path = graph.shortestPath(a, b)!
    expect(path).not.toBeNull()
    expect(path.lengthM).toBeCloseTo(20, 6)
  })

  it('splits a way at the point where another way T-s into its interior', () => {
    // way0 runs along y=0 from x=0 to x=100; way1's endpoint sits 2 m off
    // way0's interior at x=50 — within the default 4 m tolerance.
    const ways: Street[] = [
      [[0, 0], [100, 0]],
      [[50, 2], [50, 50]],
    ]
    const graph = buildStreetGraph(ways)
    // Nodes: (0,0), (100,0), the split point (~50,0), and (50,50).
    expect(graph.nodeCount).toBe(4)

    const start = graph.nearestNode([0, 0], 0.001)!
    const end = graph.nearestNode([100, 0], 0.001)!
    const tip = graph.nearestNode([50, 50], 0.001)!

    // The split node lies between start and end on way0.
    const direct = graph.shortestPath(start, end)!
    expect(direct.lengthM).toBeCloseTo(100, 6)

    const toTip = graph.shortestPath(start, tip)!
    expect(toTip.lengthM).toBeCloseTo(50 + 48, 0) // ~50 m along way0 + ~48 m up way1
  })

  it('gives an isolated way two degree-1 dead ends and one edge', () => {
    const ways: Street[] = [[[0, 0], [30, 40]]]
    const graph = buildStreetGraph(ways)
    expect(graph.nodeCount).toBe(2)
    const a = graph.nearestNode([0, 0], 0.001)!
    const b = graph.nearestNode([30, 40], 0.001)!
    const path = graph.shortestPath(a, b)!
    expect(path.lengthM).toBeCloseTo(50, 6)
    expect(path.points).toHaveLength(2)
  })

  it('finds the two-edge path across a synthetic T-junction', () => {
    // Three ways meeting exactly at the origin.
    const ways: Street[] = [
      [[0, 0], [-100, 0]],
      [[0, 0], [0, 100]],
      [[0, 0], [100, 0]],
    ]
    const graph = buildStreetGraph(ways)
    const west = graph.nearestNode([-100, 0], 0.001)!
    const north = graph.nearestNode([0, 100], 0.001)!
    const east = graph.nearestNode([100, 0], 0.001)!

    const path = graph.shortestPath(west, north)!
    expect(path.lengthM).toBeCloseTo(200, 6)
    expect(path.points[0]).toEqual([-100, 0])
    expect(path.points[path.points.length - 1]).toEqual([0, 100])

    const direct = graph.shortestPath(west, east)!
    expect(direct.lengthM).toBeCloseTo(200, 6)
  })

  it('shortestPath.edgeIds has one id per edge walked, and reveals when two paths share a street', () => {
    const ways: Street[] = [
      [[0, 0], [-100, 0]],
      [[0, 0], [0, 100]],
      [[0, 0], [100, 0]],
    ]
    const graph = buildStreetGraph(ways)
    const west = graph.nearestNode([-100, 0], 0.001)!
    const north = graph.nearestNode([0, 100], 0.001)!
    const east = graph.nearestNode([100, 0], 0.001)!

    const toNorth = graph.shortestPath(west, north)!
    // Two edges walked (west→origin, origin→north) — one id per edge, not per point.
    expect(toNorth.edgeIds).toHaveLength(2)

    const toEast = graph.shortestPath(west, east)!
    // Both paths walk the shared west→origin arm.
    expect(toNorth.edgeIds.some((id) => toEast.edgeIds.includes(id))).toBe(true)
  })

  it('two shortestPath calls over disjoint parts of a synthetic grid share no edge id', () => {
    const ways: Street[] = [
      [[0, 0], [100, 0]], // bottom
      [[100, 0], [100, 100]], // right
      [[100, 100], [0, 100]], // top
      [[0, 100], [0, 0]], // left
    ]
    const graph = buildStreetGraph(ways)
    const bl = graph.nearestNode([0, 0], 0.001)!
    const br = graph.nearestNode([100, 0], 0.001)!
    const tr = graph.nearestNode([100, 100], 0.001)!
    const tl = graph.nearestNode([0, 100], 0.001)!

    const bottom = graph.shortestPath(bl, br)! // the direct bottom edge
    const top = graph.shortestPath(tl, tr)! // the direct top edge
    expect(bottom.edgeIds.some((id) => top.edgeIds.includes(id))).toBe(false)
  })

  it('returns null for two nodes in disconnected components', () => {
    const ways: Street[] = [
      [[0, 0], [10, 0]],
      [[10000, 10000], [10010, 10000]],
    ]
    const graph = buildStreetGraph(ways)
    const a = graph.nearestNode([0, 0], 0.001)!
    const b = graph.nearestNode([10000, 10000], 0.001)!
    expect(graph.shortestPath(a, b)).toBeNull()
  })

  it('property: a random polygon\'s own vertices are always within a shortestPath at most the perimeter', () => {
    fc.assert(
      fc.property(arbPolygon(4, 20), fc.nat(), fc.nat(), (polygon, i0, j0) => {
        const n = polygon.length
        const ways: Street[] = polygon.map((p, i) => [p, polygon[(i + 1) % n]!])
        // A near-zero tolerance: adjacent polygon edges share an exact vertex
        // (distance 0), so this only needs to catch floating-point jitter —
        // not merge unrelated vertices that happen to land close together.
        const graph = buildStreetGraph(ways, { nodeMergeM: 1e-6 })
        const perimeter = pathLength(polygon as Point[], true)

        const i = i0 % n
        const j = j0 % n
        const nodeI = graph.nearestNode(polygon[i]!, 1e-6)
        const nodeJ = graph.nearestNode(polygon[j]!, 1e-6)
        expect(nodeI).not.toBeNull()
        expect(nodeJ).not.toBeNull()
        const path = graph.shortestPath(nodeI!, nodeJ!)
        expect(path).not.toBeNull()
        expect(path!.lengthM).toBeLessThanOrEqual(perimeter + 1e-6)
      }),
      { seed: 3, numRuns: 100 },
    )
  })
})

describe('buildStreetGraph — nearestAlignedPointM (Phase 11)', () => {
  // A long through-street along y=0, plus a short perpendicular side street
  // stubbing off it at x=50 — physically closer to a point just off the
  // junction, but running the wrong way.
  const through: Street = [[0, 0], [100, 0]]
  const side: Street = [[50, 0], [50, -20]]

  // 2 m from the side street, 5 m from the through-street: physically closer
  // to the (perpendicular, misaligned) side street.
  const p: Point = [52, -5]

  it('resolves onto the through-street when given a heading aligned with it, not the closer perpendicular stub', () => {
    const graph = buildStreetGraph([through, side])
    const result = graph.nearestAlignedPointM(p, [1, 0], 10, (10 * Math.PI) / 180)
    expect(result).not.toBeNull()
    expect(result!.point[1]).toBeCloseTo(0, 6) // snapped onto y=0, the through-street
    expect(result!.point[0]).toBeCloseTo(52, 6)
  })

  it('returns null when nothing aligned is within range, even though the misaligned side street is physically closer', () => {
    const graph = buildStreetGraph([through, side])
    // maxM=3: the side street (2 m away) is in range but misaligned with the
    // horizontal heading; the through-street (5 m away, aligned) is out of
    // range. Neither resolves, so the physically-closer misaligned street
    // must never be returned as a fallback.
    const result = graph.nearestAlignedPointM(p, [1, 0], 3, (10 * Math.PI) / 180)
    expect(result).toBeNull()
  })

  it('throws for a zero-length heading, unlike StreetIndex.nearestAlignedM which falls back to plain-nearest', () => {
    const graph = buildStreetGraph([through, side])
    expect(() => graph.nearestAlignedPointM(p, [0, 0], 10, (10 * Math.PI) / 180)).toThrow()
  })
})

describe('buildStreetGraph — crossing/corridor repair (Phase 9)', () => {
  it('connects two ways that cross mid-segment with no shared vertex — which Phase 7 alone misses', () => {
    const ways: Street[] = [
      [[0, 0], [100, 0]], // horizontal
      [[50, -50], [50, 50]], // vertical, crosses the first at (50, 0)
    ]
    const withoutPass3 = buildStreetGraph(ways, { corridorM: 0 })
    const a0 = withoutPass3.nearestNode([0, 0], 0.001)!
    const b0 = withoutPass3.nearestNode([50, 50], 0.001)!
    expect(withoutPass3.shortestPath(a0, b0)).toBeNull() // Phase 7's endpoint-only repair misses this

    const withPass3 = buildStreetGraph(ways)
    const a = withPass3.nearestNode([0, 0], 0.001)!
    const b = withPass3.nearestNode([50, 50], 0.001)!
    const path = withPass3.shortestPath(a, b)!
    expect(path).not.toBeNull()
    expect(path.lengthM).toBeCloseTo(50 + 50, 6) // along to (50,0), then up to (50,50)
  })

  it('connects two ways that pass within corridorM of each other in their interior, without crossing', () => {
    // The two ways' middle vertices — (50, 0) and (50, 5) — sit 5 m apart:
    // beyond nodeMergeM (4 m, so Phase 7 alone leaves them disconnected) but
    // within corridorM (6 m). Both are interior vertices of their own way
    // (shared between two of that way's segments), clear of either way's
    // overall first/last point, so this exercises the near-miss path
    // specifically, not an endpoint case.
    const way0: Street = [[0, 0], [50, 0], [100, 0]]
    const way1: Street = [[20, 5], [50, 5], [80, 5]]
    const withoutPass3 = buildStreetGraph([way0, way1], { corridorM: 0 })
    const a0 = withoutPass3.nearestNode([0, 0], 0.001)!
    const b0 = withoutPass3.nearestNode([80, 5], 0.001)!
    expect(withoutPass3.shortestPath(a0, b0)).toBeNull()

    const graph = buildStreetGraph([way0, way1], { corridorM: 6 })
    const a = graph.nearestNode([0, 0], 0.001)!
    const b = graph.nearestNode([80, 5], 0.001)!
    expect(graph.shortestPath(a, b)).not.toBeNull()
  })

  it('does not connect two ways passing farther apart than corridorM', () => {
    const way0: Street = [[0, 0], [50, 0], [100, 0]]
    const way1: Street = [[20, 8], [50, 8], [80, 8]] // 8 m apart, corridorM is 6
    const graph = buildStreetGraph([way0, way1], { corridorM: 6 })
    const a = graph.nearestNode([0, 0], 0.001)!
    const b = graph.nearestNode([80, 8], 0.001)!
    expect(graph.shortestPath(a, b)).toBeNull()
  })

  it('leaves an excluded crossing disconnected even though it is within corridorM', () => {
    const way0: Street = [[0, 0], [50, 0], [100, 0]]
    const way1: Street = [[20, 5], [50, 5], [80, 5]] // same near-miss as above, point ~[50, 2.5]
    const graph = buildStreetGraph([way0, way1], {
      corridorM: 6,
      exclusions: [[50, 2.5]],
      excludeRadiusM: 5,
    })
    const a = graph.nearestNode([0, 0], 0.001)!
    const b = graph.nearestNode([80, 5], 0.001)!
    expect(graph.shortestPath(a, b)).toBeNull()
  })

  it('property: adding the crossing/corridor pass never shrinks the largest connected component', () => {
    fc.assert(
      fc.property(arbPolygon(4, 12), arbPolygon(4, 12), (poly1, poly2) => {
        const toWays = (poly: Point[]): Street[] =>
          poly.map((p, i) => [p, poly[(i + 1) % poly.length]!])
        const ways = [...toWays(poly1), ...toWays(poly2)]

        const without = componentLengthsM(ways, { corridorM: 0 })
        const withPass3 = componentLengthsM(ways, { corridorM: 6 })
        const totalWithout = without.reduce((s, v) => s + v, 0)
        const totalWith = withPass3.reduce((s, v) => s + v, 0)
        // Adding edges only ever merges or preserves components, never splits
        // them, so total network length is unchanged and the largest share
        // can only stay the same or grow.
        expect(totalWith).toBeCloseTo(totalWithout, 6)
        expect(withPass3[0]! / totalWith).toBeGreaterThanOrEqual(without[0]! / totalWithout - 1e-9)
      }),
      { seed: 7, numRuns: 50 },
    )
  })
})

describe('buildStreetGraph (real data)', () => {
  it('is materially connected: the largest component covers most of the network length', () => {
    const network = loadStreetNetwork()
    const sizes = componentLengthsM(network.ways)
    const totalLengthM = sizes.reduce((s, v) => s + v, 0)
    const share = sizes[0]! / totalLengthM
    // eslint-disable-next-line no-console
    console.log(`largest connected component: ${(share * 100).toFixed(1)}% of network length`)
    // Phase 7 measured ~88% with endpoint-only repair; Phase 9's crossing/
    // corridor pass raised it to ~95%. Floor kept comfortably below both so
    // minor future edits to the bundled data don't make this test flaky.
    expect(share).toBeGreaterThan(0.9)
  })
})
