// Phase 22: the escalation ladder — the generator tries harder, not looser,
// before it gives up on the acceptance bar. The bar itself (see
// `metrics.ts`'s `DEFAULT_BAR`) never changes across tiers; what changes is
// how thoroughly stages 1-3 search. Runs tier 0 first and only escalates to
// a wider tier when the previous tier's best route still misses the bar,
// stopping at the first tier that clears it or after tier 2 regardless — a
// fixed, deterministic sequence, never a fourth tier. See
// docs/specs/phase-22-route-generator.md.
import type { RouteLeg } from '../app/trace'
import type { Point } from '../geometry/types'
import { distance } from '../geometry/vector'
import type { NodeId, StreetGraph } from '../graph'
import { buildLoopFromNodes, buildMapMatcher } from './mapMatch'
import { computeRouteMetrics, passesBar, worstRatio, DEFAULT_BAR } from './metrics'
import type { Bar, RouteMetrics } from './metrics'
import { placePoint, searchPoses } from './poseSearch'
import type { MetricBounds, Pose } from './poseSearch'
import { pruneSpikes } from './pruneSpikes'
import type { OrientationLayers } from './raster'

export type Tier = {
  poseCount: number
  matchRadiusM: number
  matchCandidates: number
  prunePasses: number
}

/** The three escalation tiers, widest last — see the spec's own table. */
export const TIERS: readonly Tier[] = [
  { poseCount: 120, matchRadiusM: 90, matchCandidates: 8, prunePasses: 3 },
  { poseCount: 240, matchRadiusM: 120, matchCandidates: 12, prunePasses: 5 },
  { poseCount: 400, matchRadiusM: 150, matchCandidates: 16, prunePasses: 8 },
]

/** Routes stored per circuit, at most. */
export const ROUTES_KEPT = 3
/** Kept routes' pose anchors must be at least this far apart (metres). */
export const ROUTE_SEPARATION_M = 500
/** How many of a tier's matched candidates get the expensive spike-pruning
 *  pass — the spec's own named fallback for stage 3's cost (see
 *  `pruneSpikes.ts`'s header) when an exact incremental version isn't
 *  built: only the tier's best few candidates (ranked by their *unpruned*
 *  metrics) are pruned at all, not every matched pose. Wider than
 *  `ROUTES_KEPT` so there is still a pool to pick `ROUTES_KEPT` *spatially
 *  distinct* routes from afterward. */
export const PRUNE_POOL = 10

export type GeneratedRoute = {
  pose: Pose
  points: Point[]
  legs: RouteLeg[]
  metrics: RouteMetrics
  passesBar: boolean
}

export type EscalationResult = {
  routes: GeneratedRoute[]
  escalationTier: number
  posesSearched: number
}

export type EscalationOptions = {
  bar?: Bar
  tiers?: readonly Tier[]
  routesKept?: number
  routeSeparationM?: number
  prunePool?: number
  /** Test-only hook: called once per tier actually attempted, in order —
   *  lets a test count how many tiers ran without mocking module internals. */
  onTierRun?: (tierIndex: number) => void
}

type Matched = { pose: Pose; nodeIds: NodeId[]; placedRingM: Point[] }
type Scored = Matched & { points: Point[]; legs: RouteLeg[]; metrics: RouteMetrics }

function place(circuitSamplesM: readonly Point[], pose: Pose, scale: number): Point[] {
  return circuitSamplesM.map((p) => placePoint(p, pose, scale))
}

function scoreLoop(
  nodeIds: readonly NodeId[],
  placedRingM: readonly Point[],
  graph: StreetGraph,
  circuitLengthM: number,
  scale: number,
): { points: Point[]; legs: RouteLeg[]; metrics: RouteMetrics } {
  const { points, legs } = buildLoopFromNodes(nodeIds, graph)
  const metrics = computeRouteMetrics(points, legs, placedRingM, circuitLengthM, scale, graph)
  return { points, legs, metrics }
}

/** Run one tier's stages 1-3 and return every candidate it produced, ranked
 *  best (lowest `worstRatio`) first. */
function runTier(
  circuitSamplesM: readonly Point[],
  ringPerimeterM: number,
  circuitLengthM: number,
  scale: number,
  bounds: MetricBounds,
  layers: OrientationLayers,
  graph: StreetGraph,
  tier: Tier,
  bar: Bar,
  prunePool: number,
): { candidates: Scored[]; posesSearched: number } {
  const poses = searchPoses(circuitSamplesM, ringPerimeterM, scale, bounds, layers, {
    poseCount: tier.poseCount,
  })
  const matcher = buildMapMatcher(graph, {
    radiusM: tier.matchRadiusM,
    candidatesPerSample: tier.matchCandidates,
  })

  const matched: Matched[] = []
  for (const poseEval of poses) {
    const placedRingM = place(circuitSamplesM, poseEval.pose, scale)
    const result = matcher.matchLoop(placedRingM)
    if (result) matched.push({ pose: poseEval.pose, nodeIds: result.nodeIds, placedRingM })
  }

  const unpruned: Scored[] = matched.map((m) => ({
    ...m,
    ...scoreLoop(m.nodeIds, m.placedRingM, graph, circuitLengthM, scale),
  }))
  unpruned.sort((a, b) => worstRatio(a.metrics, bar) - worstRatio(b.metrics, bar))

  const pruned: Scored[] = unpruned.slice(0, prunePool).map((candidate) => {
    const prunedNodes = pruneSpikes(candidate.nodeIds, graph, candidate.placedRingM, circuitLengthM, scale, {
      passes: tier.prunePasses,
      bar,
    })
    return { ...candidate, nodeIds: prunedNodes, ...scoreLoop(prunedNodes, candidate.placedRingM, graph, circuitLengthM, scale) }
  })
  pruned.sort((a, b) => worstRatio(a.metrics, bar) - worstRatio(b.metrics, bar))

  return { candidates: pruned, posesSearched: poses.length }
}

/** Pick up to `count` candidates whose pose anchors are at least `minSepM`
 *  apart, best-ranked first (same "diversity first, fill the rest" shape as
 *  `match/search.ts`'s own diversity pass). */
function pickDistinct(candidates: readonly Scored[], count: number, minSepM: number): Scored[] {
  const accepted: Scored[] = []
  for (const c of candidates) {
    if (accepted.length >= count) break
    const farEnough = accepted.every((a) => distance(a.pose.anchorM, c.pose.anchorM) >= minSepM)
    if (farEnough) accepted.push(c)
  }
  for (const c of candidates) {
    if (accepted.length >= count) break
    if (!accepted.includes(c)) accepted.push(c)
  }
  return accepted
}

/**
 * Generate routes for one circuit, escalating through `TIERS` until the best
 * candidate clears `bar` or tier 2 is exhausted. `circuitSamplesM` must
 * already be an evenly-resampled, centroid-at-origin, unscaled ring.
 */
export function generateRoutesForCircuit(
  circuitSamplesM: readonly Point[],
  ringPerimeterM: number,
  circuitLengthM: number,
  scale: number,
  bounds: MetricBounds,
  layers: OrientationLayers,
  graph: StreetGraph,
  opts: EscalationOptions = {},
): EscalationResult {
  const bar = opts.bar ?? DEFAULT_BAR
  const tiers = opts.tiers ?? TIERS
  const routesKept = opts.routesKept ?? ROUTES_KEPT
  const routeSeparationM = opts.routeSeparationM ?? ROUTE_SEPARATION_M
  const prunePool = opts.prunePool ?? PRUNE_POOL

  let lastResult: { candidates: Scored[]; posesSearched: number; tier: number } | null = null

  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    const tier = tiers[tierIndex]!
    const result = runTier(
      circuitSamplesM,
      ringPerimeterM,
      circuitLengthM,
      scale,
      bounds,
      layers,
      graph,
      tier,
      bar,
      prunePool,
    )
    opts.onTierRun?.(tierIndex)
    lastResult = { ...result, tier: tierIndex }
    const best = result.candidates[0]
    const isLastTier = tierIndex === tiers.length - 1
    if ((best && passesBar(best.metrics, bar)) || isLastTier) break
  }

  const { candidates, posesSearched, tier } = lastResult!
  const kept = pickDistinct(candidates, routesKept, routeSeparationM)

  return {
    routes: kept.map((c) => ({
      pose: c.pose,
      points: c.points,
      legs: c.legs,
      metrics: c.metrics,
      passesBar: passesBar(c.metrics, bar),
    })),
    escalationTier: tier,
    posesSearched,
  }
}
