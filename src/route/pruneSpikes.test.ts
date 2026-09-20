import { describe, it, expect } from 'vitest'
import type { Point } from '../geometry/types'
import { buildStreetGraph } from '../graph'
import type { Street } from '../streets'
import { pruneSpikes } from './pruneSpikes'

describe('pruneSpikes', () => {
  // A square loop A(0,0)-B(100,0)-C(100,100)-D(0,100)-A, plus a dead-end
  // spur from B straight down to S(100,-50). The circuit reference ring is
  // just the square — the spur is not part of it at all.
  const ways: Street[] = [
    [
      [0, 0],
      [100, 0],
    ], // A-B
    [
      [100, 0],
      [100, 100],
    ], // B-C
    [
      [100, 100],
      [0, 100],
    ], // C-D
    [
      [0, 100],
      [0, 0],
    ], // D-A
    [
      [100, 0],
      [100, -50],
    ], // B-S spur
  ]
  const graph = buildStreetGraph(ways)
  const A = graph.nearestNode([0, 0], 0.001)!
  const B = graph.nearestNode([100, 0], 0.001)!
  const C = graph.nearestNode([100, 100], 0.001)!
  const D = graph.nearestNode([0, 100], 0.001)!
  const S = graph.nearestNode([100, -50], 0.001)!

  const placedRingM: Point[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ]
  const circuitLengthM = 400 // the square's own perimeter

  it('loses exactly the planted out-and-back spur', () => {
    const withSpur = [A, B, S, B, C, D]
    const result = pruneSpikes(withSpur, graph, placedRingM, circuitLengthM, 1, { minWaypoints: 3 })
    expect(result).not.toContain(S)
    expect(result.length).toBe(withSpur.length - 1)
  })

  it('returns a clean loop unchanged', () => {
    const clean = [A, B, C, D]
    const result = pruneSpikes(clean, graph, placedRingM, circuitLengthM, 1, { minWaypoints: 3 })
    expect(result).toEqual(clean)
  })

  it('never prunes below minWaypoints', () => {
    const withSpur = [A, B, S, B, C, D]
    const result = pruneSpikes(withSpur, graph, placedRingM, circuitLengthM, 1, { minWaypoints: 6 })
    expect(result.length).toBeGreaterThanOrEqual(6)
  })
})
