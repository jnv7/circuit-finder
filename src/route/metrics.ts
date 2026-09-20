// Phase 22, stage 4: score a generated route against the circuit it's meant
// to resemble. Reuses `app/trace.ts`'s existing `routeDeviation` for the mean/
// max symmetric deviation (not re-implemented); adds the two measurements
// that metric never needed — discrete Fréchet distance (order-sensitive,
// unlike the symmetric nearest-distance deviation) and retraced fraction
// (Phase 20's idea, applied to the whole loop rather than per leg). See
// docs/specs/phase-22-route-generator.md.
import type { RouteLeg } from '../app/trace'
import { routeDeviation } from '../app/trace'
import { pathLength, resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import { distance } from '../geometry/vector'
import type { StreetGraph } from '../graph'

/** Sample spacing for the discrete Fréchet distance, metres. */
export const FRECHET_SAMPLE_M = 20

/** Provisional acceptance bar (2026-09-20; see the ROADMAP decision log —
 *  the user accepted these defaults without independently validating them). */
export type Bar = {
  meanM: number
  maxM: number
  ratioLo: number
  ratioHi: number
  retrace: number
}

export const DEFAULT_BAR: Bar = {
  meanM: 30,
  maxM: 100,
  ratioLo: 0.9,
  ratioHi: 1.2,
  retrace: 0.05,
}

export type RouteMetrics = {
  lengthM: number
  lengthRatio: number
  meanDeviationM: number
  maxDeviationM: number
  frechetM: number
  retracedFraction: number
}

/** Index into `ring` (closed) nearest `p`. */
function nearestRingIndex(ring: readonly Point[], p: Point): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = distance(ring[i]!, p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * Classic discrete Fréchet distance (Eiter & Mannila, 1994) between two open
 * point sequences: the minimum, over monotone pairings of `a`'s and `b`'s
 * points, of the largest single pairwise distance — order-sensitive, unlike a
 * symmetric nearest-distance measure, so a route that covers the same ground
 * by doubling back does not score as well as one that traces it once.
 */
export function discreteFrechet(a: readonly Point[], b: readonly Point[]): number {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0
  const ca = new Float64Array(n * m).fill(-1)
  const at = (i: number, j: number): number => ca[i * m + j]!
  const set = (i: number, j: number, v: number): void => {
    ca[i * m + j] = v
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = distance(a[i]!, b[j]!)
      if (i === 0 && j === 0) set(i, j, d)
      else if (i === 0) set(i, j, Math.max(at(i, j - 1), d))
      else if (j === 0) set(i, j, Math.max(at(i - 1, j), d))
      else set(i, j, Math.max(Math.min(at(i - 1, j), at(i - 1, j - 1), at(i, j - 1)), d))
    }
  }
  return ca[n * m - 1]!
}

/**
 * `discreteFrechet` between the route (open, resampled at `spacingM`) and the
 * circuit ring (closed, resampled at `spacingM` then rotated so its first
 * point is the one nearest the route's own start) — the start alignment the
 * spec calls for, so the comparison respects traversal order instead of
 * letting an arbitrary ring start index penalise an otherwise-good match.
 */
export function frechetToRing(
  routePoints: readonly Point[],
  ringM: readonly Point[],
  spacingM: number = FRECHET_SAMPLE_M,
): number {
  const routeSamples = resample(routePoints, spacingM, false)
  const ringSamples = resample(ringM, spacingM, true)
  if (routeSamples.length === 0 || ringSamples.length === 0) return 0
  const startIdx = nearestRingIndex(ringSamples, routeSamples[0]!)
  const rotated = [...ringSamples.slice(startIdx), ...ringSamples.slice(0, startIdx)]
  return discreteFrechet(routeSamples, rotated)
}

/**
 * Fraction of the route's length that is retraced ground: for every graph
 * edge walked more than once across the whole closed loop, every use beyond
 * the first counts its full length, summed and divided by the route's own
 * length. Phase 20 computed the equivalent per-landmark, for a skeleton; this
 * is the same idea over a route's `RouteLeg`s as a whole.
 */
export function retracedFraction(legs: readonly RouteLeg[], graph: StreetGraph, lengthM: number): number {
  if (lengthM === 0) return 0
  const uses = new Map<number, number>()
  for (const leg of legs) {
    for (const edgeId of leg.edgeIds) uses.set(edgeId, (uses.get(edgeId) ?? 0) + 1)
  }
  let retracedM = 0
  for (const [edgeId, count] of uses) {
    if (count < 2) continue
    retracedM += (count - 1) * graph.edgeLengthM(edgeId)
  }
  return retracedM / lengthM
}

/** Every measurement `metrics.ts` produces for one closed route, against the
 *  placed circuit ring it's meant to resemble. `routePoints` is the route's
 *  own closed polyline (last point need not repeat the first — length and
 *  deviation are computed as an open polyline, matching `routeStats`'s own
 *  convention elsewhere in this codebase). */
export function computeRouteMetrics(
  routePoints: readonly Point[],
  legs: readonly RouteLeg[],
  placedRingM: readonly Point[],
  circuitLengthM: number,
  scale: number,
  graph: StreetGraph,
): RouteMetrics {
  const lengthM = pathLength(routePoints, false)
  const { meanM, maxM } = routeDeviation(routePoints, placedRingM)
  return {
    lengthM,
    lengthRatio: circuitLengthM * scale === 0 ? 0 : lengthM / (circuitLengthM * scale),
    meanDeviationM: meanM,
    maxDeviationM: maxM,
    frechetM: frechetToRing(routePoints, placedRingM),
    retracedFraction: retracedFraction(legs, graph, lengthM),
  }
}

/** Each bar term as a multiple of its limit — 0 comfortably inside, 1 exactly
 *  at the limit, growing beyond it. The length ratio is two-sided (a range,
 *  not a ceiling): 0 anywhere inside `[ratioLo, ratioHi]`, else how far
 *  outside as a fraction of the boundary it crossed. */
export function barTerms(metrics: RouteMetrics, bar: Bar = DEFAULT_BAR): {
  meanRatio: number
  maxRatio: number
  lengthTerm: number
  retraceRatio: number
} {
  const meanRatio = metrics.meanDeviationM / bar.meanM
  const maxRatio = metrics.maxDeviationM / bar.maxM
  const retraceRatio = metrics.retracedFraction / bar.retrace
  let lengthTerm = 0
  if (metrics.lengthRatio < bar.ratioLo) lengthTerm = (bar.ratioLo - metrics.lengthRatio) / bar.ratioLo
  else if (metrics.lengthRatio > bar.ratioHi) lengthTerm = (metrics.lengthRatio - bar.ratioHi) / bar.ratioHi
  return { meanRatio, maxRatio, lengthTerm, retraceRatio }
}

/** The worst of the four bar terms — `<= 1` iff every term (so every
 *  criterion) is within the bar. Used to rank kept routes. */
export function worstRatio(metrics: RouteMetrics, bar: Bar = DEFAULT_BAR): number {
  const t = barTerms(metrics, bar)
  return Math.max(t.meanRatio, t.maxRatio, t.lengthTerm, t.retraceRatio)
}

/** Sum of the four bar terms — used by `pruneSpikes`'s greedy criterion
 *  ("lowers the sum of the acceptance-bar terms"), distinct from
 *  `worstRatio`'s max (used for ranking kept routes against the bar itself). */
export function barTermSum(metrics: RouteMetrics, bar: Bar = DEFAULT_BAR): number {
  const t = barTerms(metrics, bar)
  return t.meanRatio + t.maxRatio + t.lengthTerm + t.retraceRatio
}

export function passesBar(metrics: RouteMetrics, bar: Bar = DEFAULT_BAR): boolean {
  return worstRatio(metrics, bar) <= 1
}
