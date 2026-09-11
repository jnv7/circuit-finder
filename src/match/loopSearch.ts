// Phase 8: validate, don't search freeform. Phase 6's searchPlacements still
// finds *where* to look (a larger candidate pool this time); this module asks
// the harder question — is there a real, fully street-connected closed loop
// around each candidate's placed outline? — by routing through Phase 7's
// graph, not by estimating. See docs/specs/phase-8-routed-loop-suggestions.md.
import { routeStats } from '../app/trace'
import { pathLength } from '../geometry/path'
import type { Point } from '../geometry/types'
import { rotate as rotateVec, scale as scaleVec } from '../geometry/vector'
import type { NodeId, StreetGraph } from '../graph'
import { portoProjection } from '../porto'
import { sampleIndices } from './objective'
import { searchPlacements } from './search'
import type {
  Candidate,
  LoopSearchOptions,
  LoopSearchProgress,
  RoutedLoop,
  RoutedSuggestion,
  SearchInput,
  Suggestion,
} from './types'

/** Suggestions shown (routed first, fallback after). */
export const LOOP_RESULT_COUNT = 5
/** Geometry-ranked candidates tried before giving up. */
export const LOOP_CANDIDATE_POOL = 24
/** Even points around the placed outline that must all resolve + connect. */
export const LOOP_SAMPLES = 60
/** Reused from Phase 7's SNAP_MAX_M — per-sample snap tolerance, metres. */
export const LOOP_SNAP_MAX_M = 30
/** Reject a routed loop longer than this × the circuit's length at scale. */
export const MAX_LENGTH_RATIO = 1.5

/** Place a circuit-frame point (scale about origin → rotate → translate). */
function placePoint(p: Point, candidate: Candidate, scale: number): Point {
  const r = rotateVec(scaleVec(p, scale), candidate.rotationRad)
  return [r[0] + candidate.anchorM[0], r[1] + candidate.anchorM[1]]
}

/**
 * Try to build a real closed loop around `candidate`'s placed outline.
 * Resamples the placed ring at `opts.samples` even points; every one must
 * resolve on `graph` within `opts.snapMaxM`, and every consecutive pair
 * (closing the loop) must connect by `graph.shortestPath` — a single miss
 * returns `null`. A successful loop longer than `opts.maxLengthRatio` × the
 * circuit's length at `scale` is also rejected (a legitimately-connected but
 * far-detouring loop). `simple` is set from whether any leg's `edgeIds`
 * overlap another leg's — never rejected on its own, only reported.
 */
export function tryRouteLoop(
  circuitSamplesM: readonly Point[],
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { samples?: number; snapMaxM?: number; maxLengthRatio?: number },
): RoutedLoop | null {
  const samples = opts?.samples ?? LOOP_SAMPLES
  const snapMaxM = opts?.snapMaxM ?? LOOP_SNAP_MAX_M
  const maxLengthRatio = opts?.maxLengthRatio ?? MAX_LENGTH_RATIO

  const ring = circuitSamplesM
  const idx = sampleIndices(ring.length, samples)
  const n = idx.length

  const nodes: NodeId[] = new Array(n)
  for (let s = 0; s < n; s++) {
    const p = placePoint(ring[idx[s]!]!, candidate, scale)
    const resolved = graph.nearestPointM(p, snapMaxM)
    if (!resolved) return null
    nodes[s] = resolved.node
  }

  const legs: Array<{ lengthM: number; points: Point[]; edgeIds: readonly number[] }> = []
  for (let s = 0; s < n; s++) {
    const leg = graph.shortestPath(nodes[s]!, nodes[(s + 1) % n]!)
    if (!leg) return null
    legs.push(leg)
  }

  const points: Point[] = []
  const usedEdges = new Set<number>()
  let simple = true
  for (const leg of legs) {
    if (points.length === 0) points.push(leg.points[0]!)
    for (let i = 1; i < leg.points.length; i++) points.push(leg.points[i]!)
    for (const edgeId of leg.edgeIds) {
      if (usedEdges.has(edgeId)) simple = false
      else usedEdges.add(edgeId)
    }
  }

  const placedRing = ring.map((p) => placePoint(p, candidate, scale))
  const stats = routeStats(points, placedRing)
  if (!stats) return null

  const targetLengthM = pathLength(ring, true) * scale
  if (stats.lengthM > maxLengthRatio * targetLengthM) return null

  return {
    points,
    lengthM: stats.lengthM,
    meanDeviationM: stats.meanDeviationM,
    maxDeviationM: stats.maxDeviationM,
    simple,
  }
}

function byDeviation(a: RoutedSuggestion, b: RoutedSuggestion): number {
  return a.loop!.meanDeviationM - b.loop!.meanDeviationM || a.loop!.maxDeviationM - b.loop!.maxDeviationM
}

/**
 * Run Phase 6's search for a larger candidate pool (`loopCandidatePool`),
 * then try routing each (best geometry rank first) until `loopResultCount`
 * routed suggestions — simple or not — are found or the pool runs out.
 * Untried or failed candidates backfill the remainder as fallback (unrouted)
 * suggestions, in their original rank. Final order: every simple routed
 * suggestion (by `loop.meanDeviationM` ascending), then every non-simple
 * routed one (same ordering), then fallbacks in Phase 6's rank order.
 */
export function* searchRoutedLoops(
  input: SearchInput,
  graph: StreetGraph,
  opts: LoopSearchOptions = {},
): Generator<LoopSearchProgress, RoutedSuggestion[]> {
  const loopCandidatePool = opts.loopCandidatePool ?? LOOP_CANDIDATE_POOL
  const loopResultCount = opts.loopResultCount ?? LOOP_RESULT_COUNT
  const loopSamples = opts.loopSamples ?? LOOP_SAMPLES
  const loopSnapMaxM = opts.loopSnapMaxM ?? LOOP_SNAP_MAX_M
  const maxLengthRatio = opts.maxLengthRatio ?? MAX_LENGTH_RATIO

  const searchGen = searchPlacements(input, { ...opts, resultCount: loopCandidatePool })
  let step = searchGen.next()
  while (!step.done) {
    yield { ...step.value, phase: 'search' }
    step = searchGen.next()
  }
  const candidates: Suggestion[] = step.value

  const project = portoProjection()
  // +1 reserves a final tick so progress always lands on done === total, even
  // with zero candidates to try (mirrors searchPlacements's own convention).
  const routeTotal = candidates.length + 1

  const routed: RoutedSuggestion[] = []
  const fallback: Suggestion[] = []
  for (let i = 0; i < candidates.length; i++) {
    const s = candidates[i]!
    if (routed.length < loopResultCount) {
      const anchorM = project.toLocal(s.placement.anchor)
      const candidate: Candidate = { anchorM, rotationRad: s.placement.rotationRad }
      const loop = tryRouteLoop(input.circuitSamplesM, candidate, input.scale, graph, {
        samples: loopSamples,
        snapMaxM: loopSnapMaxM,
        maxLengthRatio,
      })
      if (loop) routed.push({ ...s, loop })
      else fallback.push(s)
    } else {
      fallback.push(s)
    }
    yield { done: i + 1, total: routeTotal, phase: 'route' }
  }
  yield { done: routeTotal, total: routeTotal, phase: 'route' }

  const simpleRouted = routed.filter((r) => r.loop!.simple).sort(byDeviation)
  const nonSimpleRouted = routed.filter((r) => !r.loop!.simple).sort(byDeviation)
  const backfillCount = Math.max(0, loopResultCount - routed.length)

  return [...simpleRouted, ...nonSimpleRouted, ...fallback.slice(0, backfillCount)]
}
