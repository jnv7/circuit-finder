import { describe, it, expect } from 'vitest'
import type { Point } from '../geometry/types'
import { buildStreetGraph } from '../graph'
import type { Street } from '../streets'
import { buildMapMatcher, buildLoopFromNodes } from './mapMatch'

// A rectangular street loop, corners at (0,0), (200,0), (200,100), (0,100),
// with a real junction node at the midpoint of each side (each side is two
// separate ways, not one — a single way's own interior points never become
// graph nodes, see graph.test.ts). Without these midpoints, a sample near the
// middle of a 200 m side would be ~100 m from the nearest node, past
// `MATCH_RADIUS_M` (90); 8 nodes keeps every node-to-node gap <= 100 m.
function buildRectangle(): Street[] {
  return [
    [
      [0, 0],
      [100, 0],
    ],
    [
      [100, 0],
      [200, 0],
    ],
    [
      [200, 0],
      [200, 50],
    ],
    [
      [200, 50],
      [200, 100],
    ],
    [
      [200, 100],
      [100, 100],
    ],
    [
      [100, 100],
      [0, 100],
    ],
    [
      [0, 100],
      [0, 50],
    ],
    [
      [0, 50],
      [0, 0],
    ],
  ]
}

describe('buildMapMatcher — obvious best loop', () => {
  // The circuit ring is a slightly inset rectangle, tracing the same shape —
  // an obvious best match visits (at least) all four true corners.
  const graph = buildStreetGraph(buildRectangle())
  const matcher = buildMapMatcher(graph, { stepM: 40 })

  const insetRing: Point[] = [
    [5, 5],
    [195, 5],
    [195, 95],
    [5, 95],
  ]

  it('visits all four rectangle corners', () => {
    const result = matcher.matchLoop(insetRing)
    expect(result).not.toBeNull()
    const corners: Point[] = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]
    const cornerIds = corners.map((c) => graph.nearestNode(c, 0.001)!)
    const visited = new Set(result!.nodeIds)
    for (const id of cornerIds) expect(visited).toContain(id)
  })

  it('builds a closed loop through the graph whose length is close to the rectangle perimeter', () => {
    const result = matcher.matchLoop(insetRing)!
    const { points } = buildLoopFromNodes(result.nodeIds, graph)
    let lengthM = 0
    for (let i = 1; i < points.length; i++) {
      lengthM += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
    }
    expect(lengthM).toBeGreaterThan(500)
    expect(lengthM).toBeLessThan(700)
  })
})

describe('buildMapMatcher — main component restriction', () => {
  // A tiny, deliberately disconnected street sitting close to one sample —
  // closer than the rectangle's own corner — so a matcher that forgot to
  // restrict candidates to the main component would wrongly prefer it.
  const isolated: Street = [
    [1, -8],
    [1, -8.5],
  ]
  const ways = [...buildRectangle(), isolated]
  const graph = buildStreetGraph(ways)
  const isolatedNodeId = graph.nearestNode([1, -8], 0.001)!

  const matcher = buildMapMatcher(graph, { stepM: 40 })
  const insetRing: Point[] = [
    [5, 5],
    [195, 5],
    [195, 95],
    [5, 95],
  ]

  it('never selects the closer, disconnected node', () => {
    expect(graph.componentOf(isolatedNodeId)).not.toBe(graph.mainComponent)
    const result = matcher.matchLoop(insetRing)!
    expect(result.nodeIds).not.toContain(isolatedNodeId)
  })
})

describe('buildMapMatcher — out of range', () => {
  const rectangle: Street[] = [
    [
      [0, 0],
      [200, 0],
    ],
    [
      [200, 0],
      [200, 100],
    ],
    [
      [200, 100],
      [0, 100],
    ],
    [
      [0, 100],
      [0, 0],
    ],
  ]
  const graph = buildStreetGraph(rectangle)
  const matcher = buildMapMatcher(graph, { stepM: 40, radiusM: 90 })

  it('returns null (not a guess) when a sample has no candidate within radius', () => {
    const farAwayRing: Point[] = [
      [10_000, 10_000],
      [10_200, 10_000],
      [10_200, 10_100],
      [10_000, 10_100],
    ]
    expect(matcher.matchLoop(farAwayRing)).toBeNull()
  })
})
