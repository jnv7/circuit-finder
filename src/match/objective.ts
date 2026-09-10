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
import { NEAR_M } from '../app/proximity'
import type { Candidate, SearchInput } from './types'

export { NEAR_M }
/** Snap search radius for the objective, metres. */
export const SEARCH_MAX_M = 40
/** Candidates below this coverage are dropped before ranking. */
export const MIN_COVERAGE = 0.45
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
  /** Below this coverage the shape terms are skipped and `score` is just a
   *  cheap `coverage - 1` — the candidate will be dropped anyway. */
  minCoverage?: number
}

/** Pick `k` roughly evenly spaced entries from a closed ring of points. */
function subsample(ring: readonly Point[], k: number): Point[] {
  const n = ring.length
  if (k >= n) return ring.map((p) => [p[0], p[1]])
  const out: Point[] = []
  for (let i = 0; i < k; i++) out.push(ring[Math.floor((i * n) / k)]!)
  return out
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

  const base = subsample(input.circuitSamplesM, samples)
  const n = base.length

  // Place: scale about the origin, rotate, then translate to the anchor.
  const placed: Point[] = base.map((p) => {
    const r = rotateVec(scaleVec(p, input.scale), c.rotationRad)
    return [r[0] + c.anchorM[0], r[1] + c.anchorM[1]]
  })

  const snapped: Point[] = new Array(n)
  let near = 0
  let devSum = 0
  let devMax = 0
  for (let i = 0; i < n; i++) {
    const { distanceM, point } = input.index.nearestPointM(placed[i]!, searchMaxM)
    snapped[i] = point ?? placed[i]!
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
