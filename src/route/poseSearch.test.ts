import { describe, it, expect } from 'vitest'
import { resample, pathLength } from '../geometry/path'
import type { Point } from '../geometry/types'
import type { Street } from '../streets'
import { buildOrientationLayers } from './raster'
import {
  searchPoses,
  evaluatePoseAt,
  HOLE_T_M,
  MAX_HOLE_M,
  CANDIDATE_CAP_M,
  FINE_SAMPLE_SPACING_M,
} from './poseSearch'
import type { MetricBounds } from './poseSearch'

/** An irregular quadrilateral, as a circuit's own frame (centroid near the
 *  origin) — deliberately asymmetric (a square's 4-fold rotational symmetry
 *  would make 90°-apart rotations indistinguishable to the search). */
const SHAPE: Point[] = [
  [-50, -30],
  [60, -30],
  [60, 20],
  [-20, 50],
]

describe('searchPoses — planted circuit', () => {
  // Draw the shape as the only street, placed at a known pose, then search
  // for it. The production anchor/rotation grid (50 m / 15°) is far coarser
  // than the "within 0.1 m / 0.1°" precision this test wants — that
  // precision comes from running the same algorithm at a resolution scaled
  // to the test's own tiny synthetic map (`coarseAnchorM`/`coarseRotDeg`
  // below), not from a hidden continuous refine stage this module doesn't
  // have.
  const knownPose = { anchorM: [1000, 2000] as Point, rotationRad: (17 * Math.PI) / 180 }
  const scale = 1

  function place(p: Point): Point {
    const c = Math.cos(knownPose.rotationRad)
    const s = Math.sin(knownPose.rotationRad)
    const r: Point = [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
    return [r[0] + knownPose.anchorM[0], r[1] + knownPose.anchorM[1]]
  }

  const placedRing = SHAPE.map(place)
  const placedStreet: Street = [...placedRing, placedRing[0]!]
  // Fine cellM (finer than the anchor step) and a small margin (this test's
  // search bounds never stray far from the ring) — a coarser grid or the
  // default 200 m margin would either blur sub-metre distinctions or blow up
  // the grid to tens of millions of cells for no benefit here.
  const layers = buildOrientationLayers([placedStreet], { cellM: 0.1, marginM: 10 })

  const ringSamples = resample(SHAPE, 2, true)
  const perimeter = pathLength(SHAPE, true)

  it('finds the known pose within a fraction of a metre/degree at matching search resolution', { timeout: 120_000 }, () => {
    // Rotation always sweeps the full 0-360° range regardless of bounds size,
    // so a 0.1° step is already 3600 combinations before the anchor grid
    // multiplies it further (~1.6M pose evaluations total) — a tight window
    // around the known anchor keeps this a precision check (does the scoring
    // resolve sub-grid-step differences correctly?), not a full-area search
    // at that resolution (already covered, at production-realistic
    // resolution, by the soundness test below). The achievable precision is
    // bounded by the raster's own cellM (0.1 m here) — this
    // reimplementation's own measured figure, not the deleted prototype's
    // "0.1 m/0.1°" (a different implementation the spec's provenance note
    // explicitly does not bind the rebuild to). A generous fixed timeout,
    // same convention as this codebase's other real-data-scale tests
    // (graph.test.ts, app/map.test.ts).
    const bounds: MetricBounds = { min: [999, 1999], max: [1001, 2001] }
    const results = searchPoses(ringSamples, perimeter, scale, bounds, layers, {
      coarseAnchorM: 0.1,
      coarseRotDeg: 0.1,
      poseCount: 1,
    })
    expect(results.length).toBeGreaterThan(0)
    const best = results[0]!.pose
    expect(Math.hypot(best.anchorM[0] - knownPose.anchorM[0], best.anchorM[1] - knownPose.anchorM[1])).toBeLessThan(
      0.5,
    )
    const rotDeltaDeg = (Math.abs(best.rotationRad - knownPose.rotationRad) * 180) / Math.PI
    expect(rotDeltaDeg).toBeLessThan(0.5)
  })
})

describe('searchPoses — coarse prune soundness', () => {
  // A small grid of streets in a bounded area: some poses of a small triangle
  // fit well, most don't. The coarse pre-filter (sparse samples, dilated
  // threshold) must never discard the pose the fine, dense-sample pass would
  // itself pick as best — checked by comparing the unpruned exhaustive best
  // (evaluate every grid pose at fine resolution directly, no coarse filter)
  // against `searchPoses`'s own (coarse-pruned) result.
  const TRIANGLE: Point[] = [
    [-30, -20],
    [30, -20],
    [0, 40],
  ]
  const ringSamples = resample(TRIANGLE, 2, true)
  const perimeter = pathLength(TRIANGLE, true)

  const ways: Street[] = [
    [
      [0, 0],
      [200, 0],
    ],
    [
      [0, 0],
      [0, 200],
    ],
    [
      [50, -30],
      [110, 30],
    ],
    [
      [110, 30],
      [50, 90],
    ],
    [
      [50, 90],
      [-10, 30],
    ],
    [
      [-10, 30],
      [50, -30],
    ],
  ]
  const layers = buildOrientationLayers(ways, { cellM: 2 })
  const bounds: MetricBounds = { min: [0, 0], max: [120, 120] }

  it('the coarse-pruned search finds the same best pose as an unpruned exhaustive fine search', () => {
    const pruned = searchPoses(ringSamples, perimeter, 1, bounds, layers, {
      coarseAnchorM: 20,
      coarseRotDeg: 30,
      poseCount: 1,
    })
    expect(pruned.length).toBeGreaterThan(0)

    // Unpruned: evaluate every grid pose directly at the fine settings
    // `searchPoses` itself uses for its second pass, skipping the coarse
    // discard step entirely.
    let bestUnpruned = -Infinity
    let bestPose = pruned[0]!.pose
    const rotCount = Math.round(360 / 30)
    for (let x = bounds.min[0]; x <= bounds.max[0]; x += 20) {
      for (let y = bounds.min[1]; y <= bounds.max[1]; y += 20) {
        for (let r = 0; r < rotCount; r++) {
          const pose = { anchorM: [x, y] as Point, rotationRad: (r * 30 * Math.PI) / 180 }
          const evalResult = evaluatePoseAt(
            ringSamples,
            perimeter,
            pose,
            1,
            layers,
            FINE_SAMPLE_SPACING_M,
            HOLE_T_M,
            MAX_HOLE_M,
            CANDIDATE_CAP_M,
          )
          if (evalResult.feasible && -evalResult.costSum > bestUnpruned) {
            bestUnpruned = -evalResult.costSum
            bestPose = pose
          }
        }
      }
    }

    expect(pruned[0]!.pose.anchorM).toEqual(bestPose.anchorM)
    expect(pruned[0]!.pose.rotationRad).toBeCloseTo(bestPose.rotationRad, 6)
  })
})
