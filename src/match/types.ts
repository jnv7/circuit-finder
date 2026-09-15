// Shared types for the Phase 6 placement search, plus the Phase 14
// corner-anchored skeleton. See docs/specs/phase-6-suggested-placements.md and
// docs/specs/phase-14-corner-anchored-placement.md.
import type { Placement } from '../app/overlay'
import type { RouteLeg } from '../app/trace'
import type { Corner } from '../geometry/corners'
import type { Point } from '../geometry/types'
import type { NodeId } from '../graph'
import type { Street, StreetIndex } from '../streets'

/** A pose for the circuit in the Porto metric frame: where its centroid sits
 *  (metres) and how much it is turned (radians CCW, matching the overlay). */
export type Candidate = { anchorM: Point; rotationRad: number }

/** A survivor of the search, ready to hand to the map. */
export type Suggestion = {
  /** Anchor as `[lon, lat]`, rotation and scale — a Phase 2 `Placement`. */
  placement: Placement
  /** 0..1, shown as the familiar "NN % on streets". */
  coverageFraction: number
  meanDeviationM: number
  maxDeviationM: number
}

/** Axis-aligned metric bounds to sweep, in the Porto frame. */
export type MetricBounds = { min: Point; max: Point }

export type SearchInput = {
  /** Circuit centreline resampled evenly, centroid at the origin. */
  circuitSamplesM: readonly Point[]
  /** The fixed scale the search runs at (the current UI scale). */
  scale: number
  index: StreetIndex
  bbox: MetricBounds
  /** Phase 12: raw street ways, for matching real straights against the
   *  circuit's own longest straight. */
  ways: readonly Street[]
  /** Phase 12: the circuit's own longest straight, local frame (centroid at
   *  the origin, unscaled — same frame as `circuitSamplesM`). */
  circuitStraight: { a: Point; b: Point; lengthM: number }
}

export type SearchProgress = { done: number; total: number }

/** Tuning knobs; every field falls back to the spec's constant. */
export type SearchOptions = Partial<{
  resultCount: number
  coarseGridM: number
  coarseRotDeg: number
  coarseKeep: number
  refineSpanM: number
  refineStepM: number
  refineSpanDeg: number
  refineStepDeg: number
  samplesCoarse: number
  samplesFine: number
  minCoverage: number
  dedupDistM: number
  dedupRotDeg: number
  /** Phase 12: minimum separation (metres) between accepted suggestions
   *  before falling back to plain score order to fill remaining slots. */
  diversityDistM: number
  /** Phase 15: macro-cell size (metres) for spatial-quota coarse-keep — at
   *  least one candidate per occupied macro-cell survives to refine, up to
   *  `coarseKeep`, instead of a flat top-N by score. */
  spreadCellM: number
  searchMaxM: number
  wTurning: number
  wProcrustes: number
  alignMaxRad: number
}>

// --- Phase 14: corner-anchored skeleton -------------------------------------

/** A significant corner of the circuit's own outline, plus the circuit's
 *  local heading there (already rotated to a placement's orientation) — used
 *  to align the per-landmark street search the same way Phase 6-12 do. */
export type Landmark = { corner: Corner; heading: Point }

/** Where a landmark currently resolves to on the real street network for a
 *  given placement: a Porto-frame point + graph node, or `null` if nothing
 *  acceptable was found (a gap, same concept as `RouteLeg.real === false`). */
export type LandmarkAnchor = {
  landmark: Landmark
  point: Point | null
  node: NodeId | null
  /** Phase 20: this landmark's own share of the loop's retraced length — the
   *  sum of repeated-edge length across its two adjacent legs, split evenly
   *  with the landmark at the other end of each. */
  retraceM: number
}

/** The closed sequence of legs connecting consecutive landmark anchors, in
 *  landmark order (the last connects back to the first). A working
 *  scratchpad while the user builds a route — not persisted directly. */
export type SkeletonLoop = {
  anchors: LandmarkAnchor[]
  legs: RouteLeg[]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  gapCount: number
  /** Phase 20: total length counted more than once across the loop's legs —
   *  real, connected street, but retraced rather than new ground. */
  retracedM: number
  /** The candidate-placed (unsnapped) landmark corner points, in landmark
   *  order — the deviation reference ring. Kept on the loop (beyond the
   *  spec's original sketch) so `moveLandmark` can recompute totals from the
   *  legs alone, without needing the placement (candidate/scale) again. */
  placedRingM: Point[]
}
