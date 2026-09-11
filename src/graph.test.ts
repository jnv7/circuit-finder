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

describe('buildStreetGraph (real data)', () => {
  it('is materially connected: the largest component covers most of the network length', () => {
    const network = loadStreetNetwork()
    const sizes = componentLengthsM(network.ways)
    const totalLengthM = sizes.reduce((s, v) => s + v, 0)
    const share = sizes[0]! / totalLengthM
    // eslint-disable-next-line no-console
    console.log(`largest connected component: ${(share * 100).toFixed(1)}% of network length`)
    // Measured on the bundled data at ~88%: a materially-connected network,
    // not a field of fragments. Floor kept comfortably below that so minor
    // future edits to the bundled data don't make this test flaky.
    expect(share).toBeGreaterThan(0.75)
  })
})
