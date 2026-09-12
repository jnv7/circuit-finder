// Shared types for the Phase 6 placement search. See
// docs/specs/phase-6-suggested-placements.md.
import type { Placement } from '../app/overlay'
import type { RouteLeg } from '../app/trace'
import type { Point } from '../geometry/types'
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
  searchMaxM: number
  wTurning: number
  wProcrustes: number
  alignMaxRad: number
}>

/** Phase 8: a real, fully street-connected closed loop built around a
 *  candidate's placed outline. See docs/specs/phase-8-routed-loop-suggestions.md. */
export type RoutedLoop = {
  /** The closed loop actually run, Porto-frame metres, first point repeated
   *  at the end. */
  points: Point[]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  /** True iff no underlying street edge was walked by more than one leg —
   *  a real closed loop, not a there-and-back spur that happens to connect
   *  end to end. */
  simple: boolean
}

/** Phase 10: a loop that always exists — every leg is a real routed street
 *  segment or, where the network doesn't cooperate, a straight "gap" segment,
 *  clearly flagged rather than silently included or the candidate rejected.
 *  See docs/specs/phase-10-best-effort-routed-loops.md. */
export type BestEffortLoop = {
  legs: RouteLeg[]
  /** The closed loop actually run, Porto-frame metres, first point repeated
   *  at the end. */
  points: Point[]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  /** Straight-line length of every gap leg, metres — the ranking key. */
  gapLengthM: number
  gapCount: number
}

/** A Phase 6 `Suggestion` with a routed loop attached, when one was found. */
export type RoutedSuggestion = Suggestion & {
  /** A fully-connected loop (Phase 8). Mutually exclusive with `bestEffort`. */
  loop?: RoutedLoop
  /** A best-effort loop (Phase 10), present when no fully-routed loop was
   *  found for this candidate but a real attempt still exists. */
  bestEffort?: BestEffortLoop
}

export type LoopSearchProgress = SearchProgress & { phase: 'search' | 'route' }

export type LoopSearchOptions = SearchOptions &
  Partial<{
    loopCandidatePool: number
    loopResultCount: number
    loopSamples: number
    loopSnapMaxM: number
    maxLengthRatio: number
  }>
