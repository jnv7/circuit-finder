import { describe, it, expect } from 'vitest'
import { resample, pathLength } from '../geometry/path'
import type { Point } from '../geometry/types'
import { buildStreetGraph } from '../graph'
import type { Street } from '../streets'
import { generateRoutesForCircuit, TIERS } from './escalate'
import type { MetricBounds } from './poseSearch'
import { buildOrientationLayers } from './raster'

// A rectangle circuit shape, corners (0,0)-(200,0)-(200,100)-(0,100), in the
// circuit's own frame (centroid at the origin already, since the rectangle is
// symmetric about its centre — recenter isn't needed for this synthetic
// fixture).
const RECT_CIRCUIT: Point[] = [
  [-100, -50],
  [100, -50],
  [100, 50],
  [-100, 50],
]
const circuitSamplesM = resample(RECT_CIRCUIT, 5, true)
const ringPerimeterM = pathLength(RECT_CIRCUIT, true)
const circuitLengthM = ringPerimeterM
const scale = 1
const bounds: MetricBounds = { min: [950, 950], max: [1050, 1050] }

/** The real street network: a rectangle at (900,950)-(1100,950)-(1100,1050)-
 *  (900,1050) (same shape as the circuit, no rotation needed — the circuit's
 *  own corners are ±100/±50 about its centroid, so placed at anchor
 *  (1000,1000) with rotation 0 it lands exactly on this rectangle). Every
 *  side but the bottom is split at its midpoint (a real junction node); the
 *  bottom stays one long 200 m way on purpose — see `describe` blocks below. */
function buildStreets(splitBottom: boolean): Street[] {
  const bottom: Street[] = splitBottom
    ? [
        [
          [900, 950],
          [1000, 950],
        ],
        [
          [1000, 950],
          [1100, 950],
        ],
      ]
    : [
        [
          [900, 950],
          [1100, 950],
        ],
      ]
  return [
    ...bottom,
    // Right, top and left are always split at their own midpoint, so only
    // the bottom's split-or-not is what varies between the two tests below.
    [
      [1100, 950],
      [1100, 1000],
    ],
    [
      [1100, 1000],
      [1100, 1050],
    ],
    [
      [1100, 1050],
      [1000, 1050],
    ],
    [
      [1000, 1050],
      [900, 1050],
    ],
    [
      [900, 1050],
      [900, 1000],
    ],
    [
      [900, 1000],
      [900, 950],
    ],
  ]
}

describe('generateRoutesForCircuit — escalation ladder', () => {
  it('clears the bar already at tier 0 and never runs tiers 1-2', () => {
    const graph = buildStreetGraph(buildStreets(true))
    const layers = buildOrientationLayers(buildStreets(true), { cellM: 2 })
    const tiersRun: number[] = []
    const result = generateRoutesForCircuit(
      circuitSamplesM,
      ringPerimeterM,
      circuitLengthM,
      scale,
      bounds,
      layers,
      graph,
      { onTierRun: (t) => tiersRun.push(t) },
    )
    expect(result.escalationTier).toBe(0)
    expect(tiersRun).toEqual([0])
    expect(result.routes[0]?.passesBar).toBe(true)
  })

  it('escalates to tier 1 when tier 0 cannot reach a node within its narrower radius', () => {
    // The bottom side is one 200 m way (no midpoint node): a sample at its
    // middle is ~100 m from either corner — past tier 0's 90 m radius, within
    // tier 1's 120 m.
    const graph = buildStreetGraph(buildStreets(false))
    const layers = buildOrientationLayers(buildStreets(false), { cellM: 2 })
    const tiersRun: number[] = []
    const result = generateRoutesForCircuit(
      circuitSamplesM,
      ringPerimeterM,
      circuitLengthM,
      scale,
      bounds,
      layers,
      graph,
      { onTierRun: (t) => tiersRun.push(t) },
    )
    expect(tiersRun).toEqual([0, 1])
    expect(result.escalationTier).toBe(1)
  })

  it('runs all three tiers and reports passesBar: false when no tier clears the bar', () => {
    // The right side is replaced by a long, structurally mandatory bulge —
    // the only path in the graph between the two right-hand corners — so
    // every matched route's length ends up well over the bar's ratioHi
    // (1.2x), on every tier: widening the search radius or candidate count
    // never fixes a *topological* detour, only pruning spurious waypoints
    // does, and this one isn't spurious, it's the only way through.
    const bulged: Street[] = [
      [
        [900, 950],
        [1000, 950],
      ], // bottom, first half
      [
        [1000, 950],
        [1100, 950],
      ], // bottom, second half
      [
        [1100, 950],
        [1300, 1000],
      ], // right side, replaced by a long bulge...
      [
        [1300, 1000],
        [1100, 1050],
      ], // ...the only path between the two right corners
      [
        [1100, 1050],
        [1000, 1050],
      ], // top, first half
      [
        [1000, 1050],
        [900, 1050],
      ], // top, second half
      [
        [900, 1050],
        [900, 1000],
      ], // left, first half
      [
        [900, 1000],
        [900, 950],
      ], // left, second half
    ]
    const graph = buildStreetGraph(bulged)
    const layers = buildOrientationLayers(bulged, { cellM: 2 })
    const tiersRun: number[] = []
    const result = generateRoutesForCircuit(
      circuitSamplesM,
      ringPerimeterM,
      circuitLengthM,
      scale,
      bounds,
      layers,
      graph,
      { onTierRun: (t) => tiersRun.push(t) },
    )
    expect(tiersRun).toEqual([0, 1, 2])
    expect(result.escalationTier).toBe(2)
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.routes.every((r) => r.passesBar === false)).toBe(true)
  })

  it('the tier table matches the spec', () => {
    expect(TIERS).toEqual([
      { poseCount: 120, matchRadiusM: 90, matchCandidates: 8, prunePasses: 3 },
      { poseCount: 240, matchRadiusM: 120, matchCandidates: 12, prunePasses: 5 },
      { poseCount: 400, matchRadiusM: 150, matchCandidates: 16, prunePasses: 8 },
    ])
  })
})
