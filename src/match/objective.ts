// Per-candidate objective for the Phase 6 search. Given a pose, place the
// circuit samples in the Porto frame, snap each to its nearest street point, and
// combine three signals into one rank-only score:
//   - coverage:            how much of the outline sits on a street (want high)
//   - turningDistance:     do the streets bend like the circuit? (want low)
//   - procrustesResidual:  do the snapped points trace the circuit? (want low)
// The headline numbers shown to the user are only `coverage` and the metre
// deviations — turning / Procrustes are internal plumbing. All pure.
import { cumulativeTurning, turningDistance } from '../geometry/turning'
import { procrustesResidual } from '../geometry/procrustes'
import type { Point } from '../geometry/types'
import { rotate as rotateVec, scale as scaleVec } from '../geometry/vector'
import { ALIGN_MAX_DEG, NEAR_M } from '../app/proximity'
import type { Candidate, SearchInput } from './types'

export { NEAR_M }
/** Snap search radius for the objective, metres. */
export const SEARCH_MAX_M = 40
/** Heading tolerance for "runnable here", radians (see `ALIGN_MAX_DEG`). */
export const ALIGN_MAX_RAD = (ALIGN_MAX_DEG * Math.PI) / 180
/** Candidates below this coverage are dropped before ranking. */
export const MIN_COVERAGE = 0.4
/** Ranking weights (scale-free — `turningDistance` is radians, the Procrustes
 *  residual is normalised by the circuit radius). */
export const W_TURNING = 0.15
export const W_PROCRUSTES = 0.2

export type CandidateScore = {
  coverage: number
  turningDistance: number
  procrustesResidual: number
  procrustesResidualNorm: number
  meanDeviationM: number
  maxDeviationM: number
  score: number
}

export type ScoreOptions = {
  searchMaxM?: number
  wTurning?: number
  wProcrustes?: number
  alignMaxRad?: number
  /** Below this coverage the shape terms are skipped and `score` is just a
   *  cheap `coverage - 1` — the candidate will be dropped anyway. */
  minCoverage?: number
}

/** Local-tangent half-window, in ring indices, for the per-sample heading. */
const HEADING_SPAN = 2

/** The circuit's own local direction of travel at ring index `i`, placed at
 *  `rotationRad` — the chord between the points `HEADING_SPAN` indices ahead
 *  and behind. Factored out of `scoreCandidate` so loop construction
 *  (Phase 11) can compute the same heading a sample was scored with. */
export function localHeading(ring: readonly Point[], i: number, rotationRad: number): Point {
  const n = ring.length
  const ahead = ring[(i + HEADING_SPAN) % n]!
  const behind = ring[(i - HEADING_SPAN + n) % n]!
  return rotateVec([ahead[0] - behind[0], ahead[1] - behind[1]], rotationRad)
}

/** `k` roughly evenly spaced indices into a closed ring of `n` points. */
export function sampleIndices(n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i)
  return Array.from({ length: k }, (_, i) => Math.floor((i * n) / k))
}

/** Largest distance of any sample from the circuit's centroid-at-origin. */
function boundingRadius(samples: readonly Point[]): number {
  let r = 0
  for (const p of samples) {
    const d = Math.hypot(p[0], p[1])
    if (d > r) r = d
  }
  return r
}

/**
 * Score `c` against `input`, using `samples` centreline points. Cheaper coarse
 * passes use fewer samples; the refine pass uses more.
 */
export function scoreCandidate(
  input: SearchInput,
  c: Candidate,
  samples: number,
  opts: ScoreOptions = {},
): CandidateScore {
  const searchMaxM = opts.searchMaxM ?? SEARCH_MAX_M
  const wTurning = opts.wTurning ?? W_TURNING
  const wProcrustes = opts.wProcrustes ?? W_PROCRUSTES
  const alignMaxRad = opts.alignMaxRad ?? ALIGN_MAX_RAD

  const ring = input.circuitSamplesM
  const rn = ring.length
  const idx = sampleIndices(rn, samples)
  const n = idx.length

  // Untransformed circuit samples (centroid ~origin) for the Procrustes fit.
  const base: Point[] = idx.map((i) => ring[i]!)

  // Place each sample (scale about origin → rotate → translate) and snap it to
  // the nearest street that also *runs the same way* as the circuit does here.
  const placed: Point[] = new Array(n)
  const snapped: Point[] = new Array(n)
  let near = 0
  let devSum = 0
  let devMax = 0
  for (let s = 0; s < n; s++) {
    const i = idx[s]!
    const r = rotateVec(scaleVec(ring[i]!, input.scale), c.rotationRad)
    const p: Point = [r[0] + c.anchorM[0], r[1] + c.anchorM[1]]
    placed[s] = p

    const heading = localHeading(ring, i, c.rotationRad)

    const { distanceM, point } = input.index.nearestAlignedM(p, heading, searchMaxM, alignMaxRad)
    snapped[s] = point ?? p
    if (distanceM < NEAR_M) near++
    devSum += distanceM
    if (distanceM > devMax) devMax = distanceM
  }

  const coverage = n === 0 ? 0 : near / n
  const meanDeviationM = n === 0 ? 0 : devSum / n
  const maxDeviationM = devMax

  // Mostly-off-street candidates are dropped before ranking, so don't pay for
  // the shape terms — return a cheap, safely-low score.
  if (coverage < (opts.minCoverage ?? -Infinity)) {
    return {
      coverage,
      turningDistance: Infinity,
      procrustesResidual: Infinity,
      procrustesResidualNorm: Infinity,
      meanDeviationM,
      maxDeviationM,
      score: coverage - 1,
    }
  }

  const turnDist = turningDistance(
    cumulativeTurning(placed, true),
    cumulativeTurning(snapped, true),
  )
  const residual = procrustesResidual(snapped, base)
  const radius = boundingRadius(base)
  const residualNorm = radius > 0 ? residual / radius : residual

  const score = coverage - wTurning * turnDist - wProcrustes * residualNorm

  return {
    coverage,
    turningDistance: turnDist,
    procrustesResidual: residual,
    procrustesResidualNorm: residualNorm,
    meanDeviationM,
    maxDeviationM,
    score,
  }
}
