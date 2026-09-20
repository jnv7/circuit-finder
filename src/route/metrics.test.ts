import { describe, it, expect } from 'vitest'
import type { RouteLeg } from '../app/trace'
import type { Point } from '../geometry/types'
import { buildStreetGraph } from '../graph'
import type { Street } from '../streets'
import { discreteFrechet, retracedFraction, worstRatio, DEFAULT_BAR } from './metrics'
import type { RouteMetrics } from './metrics'

describe('discreteFrechet', () => {
  const curve: Point[] = [
    [0, 0],
    [10, 0],
    [20, 5],
    [30, 0],
  ]

  it('is 0 for identical curves', () => {
    expect(discreteFrechet(curve, curve)).toBeCloseTo(0, 9)
  })

  it('equals the shift for a uniformly translated copy', () => {
    const shifted = curve.map(([x, y]) => [x, y + 7] as Point)
    expect(discreteFrechet(curve, shifted)).toBeCloseTo(7, 6)
  })

  it('is order-sensitive: a reversed traversal is not small', () => {
    const reversed = [...curve].reverse()
    expect(discreteFrechet(curve, reversed)).toBeGreaterThan(5)
  })
})

describe('retracedFraction', () => {
  // A simple 4-node path graph: a-b-c-d, each edge 100 m.
  const ways: Street[] = [
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
      [300, 0],
    ],
  ]
  const graph = buildStreetGraph(ways)
  const a = graph.nearestNode([0, 0], 0.001)!
  const b = graph.nearestNode([100, 0], 0.001)!
  const c = graph.nearestNode([200, 0], 0.001)!

  it('a loop that walks one edge twice reports that edge\'s length share', () => {
    const legAB = graph.shortestPath(a, b)!
    const legBC = graph.shortestPath(b, c)!
    const legBA = graph.shortestPath(b, a)! // retraces the same a-b edge
    const legs: RouteLeg[] = [
      { points: legAB.points, real: true, edgeIds: legAB.edgeIds },
      { points: legBC.points, real: true, edgeIds: legBC.edgeIds },
      { points: legBA.points, real: true, edgeIds: legBA.edgeIds },
    ]
    const totalLengthM = legAB.lengthM + legBC.lengthM + legBA.lengthM // 100+100+100
    const fraction = retracedFraction(legs, graph, totalLengthM)
    // The a-b edge (100 m) is walked twice: one retraced use, over a 300 m
    // total route -> 100/300.
    expect(fraction).toBeCloseTo(100 / 300, 6)
  })

  it('a loop with no repeated edge has zero retraced fraction', () => {
    const legAB = graph.shortestPath(a, b)!
    const legBC = graph.shortestPath(b, c)!
    const legs: RouteLeg[] = [
      { points: legAB.points, real: true, edgeIds: legAB.edgeIds },
      { points: legBC.points, real: true, edgeIds: legBC.edgeIds },
    ]
    const totalLengthM = legAB.lengthM + legBC.lengthM
    expect(retracedFraction(legs, graph, totalLengthM)).toBe(0)
  })
})

describe('worstRatio', () => {
  const goodMetrics: RouteMetrics = {
    lengthM: 5000,
    lengthRatio: 1.0,
    meanDeviationM: 10,
    maxDeviationM: 50,
    frechetM: 80,
    retracedFraction: 0.01,
  }
  const badMetrics: RouteMetrics = {
    lengthM: 8000,
    lengthRatio: 1.6,
    meanDeviationM: 60,
    maxDeviationM: 250,
    frechetM: 300,
    retracedFraction: 0.2,
  }

  it('is <= 1 exactly when every bar term is within the bar', () => {
    expect(worstRatio(goodMetrics, DEFAULT_BAR)).toBeLessThanOrEqual(1)
    expect(worstRatio(badMetrics, DEFAULT_BAR)).toBeGreaterThan(1)
  })

  it('a metric right at a limit scores exactly 1 on that term', () => {
    const atMeanLimit: RouteMetrics = { ...goodMetrics, meanDeviationM: DEFAULT_BAR.meanM }
    expect(worstRatio(atMeanLimit, DEFAULT_BAR)).toBeCloseTo(1, 6)
  })
})
