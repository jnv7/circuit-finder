// Phase 22, stage 1b: exhaustively search every (anchor, rotation) pose of the
// circuit, at a fixed 50 m / 15° grid, for the ones whose outline runs close
// to real, well-aligned streets — candidates for stage 2's map matching to
// resolve into an actual route. A cheap coarse pass (sparse samples, a
// dilated hole threshold) discards grid points that cannot possibly pass the
// real (dense-sample, strict-threshold) test; it never ranks, only prunes,
// and is sound by construction — see `coarseMaxHoleM` below. See
// docs/specs/phase-22-route-generator.md.
import { rotate as rotateVec, scale as scaleVec } from '../geometry/vector'
import type { Point } from '../geometry/types'
import type { OrientationLayers } from './raster'

/** Anchor grid spacing for the exhaustive search, metres. This is the search's
 *  actual resolution — there is no further, finer anchor/rotation grid; a
 *  candidate pose's own street alignment tolerance (see `raster.ts`'s
 *  `ALIGN_DEG`) absorbs the rest. */
export const COARSE_ANCHOR_M = 50
/** Rotation grid step, degrees. */
export const COARSE_ROT_DEG = 15
/** A sample farther than this from its aligned layer counts as "off". */
export const HOLE_T_M = 30
/** A run of consecutive off samples longer than this rules the pose out. */
export const MAX_HOLE_M = 200
/** Per-sample cost cap, metres — a very bad sample costs no more than this,
 *  so one catastrophic sample doesn't dominate the whole pose's ranking. */
export const CANDIDATE_CAP_M = 60
/** How many distinct poses to keep for stage 2. */
export const POSE_COUNT = 120
/** Two poses closer than this (metres) and... */
export const POSE_DEDUP_M = 150
/** ...within this many degrees of each other are the same pose for dedup. */
export const POSE_DEDUP_DEG = 10

/** Sample spacing for the real (fine) hole/cost evaluation, metres. Not itself
 *  named in the spec's constants table — it is this module's own scoring
 *  resolution, independent of the anchor/rotation grid above. */
export const FINE_SAMPLE_SPACING_M = 20
/** Sample spacing for the cheap coarse pre-filter, metres — sparser on
 *  purpose (that sparsity is exactly the "slack" `coarseMaxHoleM` dilates
 *  the threshold by, so the pre-filter can never be stricter than the real
 *  test). */
const COARSE_SAMPLE_SPACING_M = 100

export type Pose = { anchorM: Point; rotationRad: number }
export type MetricBounds = { min: Point; max: Point }

export type PoseEval = {
  pose: Pose
  /** Sum of capped per-sample distances — lower is a better-aligned pose. */
  costSum: number
  /** Longest run of consecutive off-samples, metres. */
  maxHoleM: number
  feasible: boolean
}

/** The circuit's own local direction of travel at ring index `i`, rotated by
 *  `rotationRad` — same "chord a couple of indices either side" convention
 *  used elsewhere in this codebase, kept local to `route/` rather than
 *  imported from `match/` so the two subsystems stay decoupled. */
const HEADING_SPAN = 2
function localHeading(ring: readonly Point[], i: number, rotationRad: number): Point {
  const n = ring.length
  const ahead = ring[(i + HEADING_SPAN) % n]!
  const behind = ring[(i - HEADING_SPAN + n) % n]!
  return rotateVec([ahead[0] - behind[0], ahead[1] - behind[1]], rotationRad)
}

/** Place a circuit-frame point under a pose: scale about the origin, then
 *  rotate, then translate — shared by every stage that needs to convert a
 *  circuit-frame point into the Porto frame. */
export function placePoint(p: Point, pose: Pose, scale: number): Point {
  const r = rotateVec(scaleVec(p, scale), pose.rotationRad)
  return [r[0] + pose.anchorM[0], r[1] + pose.anchorM[1]]
}

/** `k` indices into a closed ring of `n` points, spaced roughly `spacingM`
 *  apart along the ring's own arc length (`ring` is assumed already resampled
 *  evenly, as `circuitSamplesM` is throughout this codebase). */
function indicesAtSpacing(n: number, ringPerimeterM: number, spacingM: number): number[] {
  const step = Math.max(1, Math.round(n / Math.max(1, Math.round(ringPerimeterM / spacingM))))
  const out: number[] = []
  for (let i = 0; i < n; i += step) out.push(i)
  return out
}

function layerForHeading(heading: Point, layers: OrientationLayers): number {
  const angle = Math.atan2(heading[1], heading[0])
  const mod = ((angle % Math.PI) + Math.PI) % Math.PI
  return Math.round(mod / (Math.PI / layers.layerCount)) % layers.layerCount
}

/**
 * Evaluate one pose against the rasterised network at sample spacing
 * `spacingM`, with `holeThresholdM` deciding "on" vs "off" and `maxHoleM`
 * the feasibility cutoff — the shared core both the coarse and fine passes
 * use, so their only real difference is which numbers they call it with.
 */
export function evaluatePoseAt(
  circuitSamplesM: readonly Point[],
  ringPerimeterM: number,
  pose: Pose,
  scale: number,
  layers: OrientationLayers,
  spacingM: number,
  holeThresholdM: number,
  maxHoleM: number,
  capM: number = CANDIDATE_CAP_M,
): PoseEval {
  const n = circuitSamplesM.length
  const idx = indicesAtSpacing(n, ringPerimeterM, spacingM)
  const actualSpacingM = ringPerimeterM / idx.length

  let costSum = 0
  let maxHole = 0
  let currentHole = 0
  for (const i of idx) {
    const sample = circuitSamplesM[i]!
    const p = placePoint(sample, pose, scale)
    const heading = localHeading(circuitSamplesM, i, pose.rotationRad)
    const layer = layerForHeading(heading, layers)
    const distanceM = layers.distanceAt(layer, p)
    costSum += Math.min(distanceM, capM)
    if (distanceM > holeThresholdM) {
      currentHole += actualSpacingM
      if (currentHole > maxHole) maxHole = currentHole
    } else {
      currentHole = 0
    }
  }
  // The ring wraps: a hole spanning the last sample(s) and the first
  // sample(s) is one continuous run, not two separate ones.
  if (currentHole > 0 && currentHole < ringPerimeterM) {
    let wrapped = currentHole
    for (const i of idx) {
      const sample = circuitSamplesM[i]!
      const p = placePoint(sample, pose, scale)
      const heading = localHeading(circuitSamplesM, i, pose.rotationRad)
      const layer = layerForHeading(heading, layers)
      const distanceM = layers.distanceAt(layer, p)
      if (distanceM > holeThresholdM) {
        wrapped += actualSpacingM
        if (wrapped > maxHole) maxHole = wrapped
      } else break
    }
  }

  return { pose, costSum, maxHoleM: maxHole, feasible: maxHole <= maxHoleM }
}

/** Smallest absolute angular difference, radians, in `[0, π]`. */
function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}

function isDuplicate(a: Pose, b: Pose, distM: number, rotRad: number): boolean {
  return (
    Math.hypot(a.anchorM[0] - b.anchorM[0], a.anchorM[1] - b.anchorM[1]) <= distM &&
    angleDelta(a.rotationRad, b.rotationRad) <= rotRad
  )
}

export type PoseSearchOptions = {
  coarseAnchorM?: number
  coarseRotDeg?: number
  holeThresholdM?: number
  maxHoleM?: number
  candidateCapM?: number
  poseCount?: number
  poseDedupM?: number
  poseDedupDeg?: number
}

/**
 * Exhaustively search the 50 m / 15° anchor/rotation grid over `bounds` and
 * return up to `poseCount` distinct feasible poses, best (lowest cost) first.
 * `circuitSamplesM` must already be an evenly-resampled, centroid-at-origin,
 * unscaled ring (same convention `match/types.ts`'s `SearchInput` uses).
 */
export function searchPoses(
  circuitSamplesM: readonly Point[],
  ringPerimeterM: number,
  scale: number,
  bounds: MetricBounds,
  layers: OrientationLayers,
  opts: PoseSearchOptions = {},
): PoseEval[] {
  const coarseAnchorM = opts.coarseAnchorM ?? COARSE_ANCHOR_M
  const coarseRotDeg = opts.coarseRotDeg ?? COARSE_ROT_DEG
  const holeThresholdM = opts.holeThresholdM ?? HOLE_T_M
  const maxHoleM = opts.maxHoleM ?? MAX_HOLE_M
  const capM = opts.candidateCapM ?? CANDIDATE_CAP_M
  const poseCount = opts.poseCount ?? POSE_COUNT
  const poseDedupM = opts.poseDedupM ?? POSE_DEDUP_M
  const poseDedupDeg = opts.poseDedupDeg ?? POSE_DEDUP_DEG
  const poseDedupRad = (poseDedupDeg * Math.PI) / 180

  // Sound dilation: sparse coarse sampling can overestimate a real hole's
  // measured length by up to roughly one coarse sample step (a brief return
  // to an aligned street between two coarse samples goes unseen); inflating
  // the coarse cutoff by twice that step keeps the pre-filter from ever
  // rejecting a pose the fine pass — which samples far more densely — would
  // in fact accept.
  const coarseMaxHoleM = maxHoleM + 2 * COARSE_SAMPLE_SPACING_M

  const rotStepRad = (coarseRotDeg * Math.PI) / 180
  const rotCount = Math.round(360 / coarseRotDeg)

  const survivors: Pose[] = []
  for (let x = bounds.min[0]; x <= bounds.max[0]; x += coarseAnchorM) {
    for (let y = bounds.min[1]; y <= bounds.max[1]; y += coarseAnchorM) {
      for (let r = 0; r < rotCount; r++) {
        const pose: Pose = { anchorM: [x, y], rotationRad: r * rotStepRad }
        const coarse = evaluatePoseAt(
          circuitSamplesM,
          ringPerimeterM,
          pose,
          scale,
          layers,
          COARSE_SAMPLE_SPACING_M,
          holeThresholdM,
          coarseMaxHoleM,
          capM,
        )
        if (coarse.feasible) survivors.push(pose)
      }
    }
  }

  const evaluated = survivors.map((pose) =>
    evaluatePoseAt(
      circuitSamplesM,
      ringPerimeterM,
      pose,
      scale,
      layers,
      FINE_SAMPLE_SPACING_M,
      holeThresholdM,
      maxHoleM,
      capM,
    ),
  )
  const feasible = evaluated.filter((e) => e.feasible)
  feasible.sort((a, b) => a.costSum - b.costSum)

  const kept: PoseEval[] = []
  for (const candidate of feasible) {
    if (kept.length >= poseCount) break
    if (kept.some((k) => isDuplicate(k.pose, candidate.pose, poseDedupM, poseDedupRad))) continue
    kept.push(candidate)
  }
  return kept
}
