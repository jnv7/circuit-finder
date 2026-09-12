// Traced-route measurements: how long the hand-drawn route is, and how far it
// strays from the placed circuit centreline. All pure and in the shared Porto
// metric frame — the caller projects the route and the centreline ring before
// calling. There is deliberately no single "match %": the numbers are plain
// measurements (metres), the user judges what is close enough. See
// docs/specs/phase-5-trace-and-study.md.
import type { NodeId, StreetGraph } from '../graph'
import { distanceToSegment } from '../geometry/nearest'
import { pathLength, resample } from '../geometry/path'
import type { Point } from '../geometry/types'

/**
 * "Any point on the graph" tolerance for resolving a waypoint to its nearest
 * node before routing — generous because a waypoint stored in `AppState.route`
 * is already a network point (Phase 7 click-snapping), not an arbitrary click.
 */
const EXPAND_SNAP_M = 100_000

/** Resample spacing, metres, for the deviation figure. */
export const DEV_SAMPLE_M = 10

export type RouteStats = {
  /** Route length in metres (open polyline). */
  lengthM: number
  /** Mean of every symmetric nearest-distance sample, metres. */
  meanDeviationM: number
  /** Largest nearest-distance sample, metres (Hausdorff-style). */
  maxDeviationM: number
}

/** One stretch of a joined route: a real routed street segment, or — where
 *  the network didn't cooperate — a straight line flagged `real: false`. */
export type RouteLeg = { points: Point[]; real: boolean }

/** Length of the traced route (open polyline). */
export function routeLengthM(metricRoute: readonly Point[]): number {
  return pathLength(metricRoute, false)
}

/**
 * Join consecutive waypoints leg by leg: `nodes[i]` is the network node
 * already resolved for `waypoints[i]` (or `null` if none was), and a leg
 * routes by real shortest path when both its endpoints resolved and the graph
 * connects them, else falls back to a straight line between the two points
 * actually used, flagged `real: false`. Shared by `expandRouteWithGaps`
 * (manual tracing) and `match/loopSearch`'s `buildBestEffortLoop` (routed
 * suggestions) — the two differ only in how generously they resolve nodes.
 */
export function joinWaypoints(
  waypoints: readonly Point[],
  nodes: readonly (NodeId | null)[],
  graph: StreetGraph,
): { points: Point[]; legs: RouteLeg[] } {
  const points: Point[] = []
  const legs: RouteLeg[] = []
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!
    const b = waypoints[i]!
    const fromNode = nodes[i - 1]!
    const toNode = nodes[i]!
    const routed = fromNode !== null && toNode !== null ? graph.shortestPath(fromNode, toNode) : null
    const legPoints = routed ? routed.points : [a, b]
    legs.push({ points: legPoints, real: routed !== null })
    if (points.length === 0) points.push(legPoints[0]!)
    for (let j = 1; j < legPoints.length; j++) points.push(legPoints[j]!)
  }
  return { points, legs }
}

/**
 * Waypoints joined leg by leg: a real routed path where the graph connects
 * them, a straight line — flagged `real: false` — where it doesn't. Each
 * waypoint resolves to its nearest node with a generous tolerance, since a
 * waypoint stored in `AppState.route` is already a network point (Phase 7
 * click-snapping), not an arbitrary click.
 */
export function expandRouteWithGaps(
  waypoints: readonly Point[],
  graph: StreetGraph,
): { points: Point[]; legs: RouteLeg[] } {
  if (waypoints.length === 0) return { points: [], legs: [] }
  if (waypoints.length === 1) return { points: [[waypoints[0]![0], waypoints[0]![1]]], legs: [] }

  const nodes = waypoints.map((p) => graph.nearestNode(p, EXPAND_SNAP_M))
  return joinWaypoints(waypoints, nodes, graph)
}

/** Nearest distance from `p` to a polyline (its closing segment included when `closed`). */
function nearestOnPolyline(p: Point, poly: readonly Point[], closed: boolean): number {
  let best = Infinity
  for (let i = 0; i < poly.length - 1; i++) {
    const d = distanceToSegment(p, poly[i]!, poly[i + 1]!)
    if (d < best) best = d
  }
  if (closed && poly.length > 1) {
    const d = distanceToSegment(p, poly[poly.length - 1]!, poly[0]!)
    if (d < best) best = d
  }
  return best
}

/**
 * Symmetric deviation between the traced route (open) and the placed centreline
 * ring (closed), both in Porto-frame metres. Resamples each at `sampleM`, then
 * for every route sample measures the nearest distance to the ring and for
 * every ring sample the nearest distance to the route. Returns the mean over
 * all those samples and the largest single one — so a route that only covers
 * part of the shape still shows a large `maxM` via the ring→route direction.
 */
export function routeDeviation(
  metricRoute: readonly Point[],
  metricRing: readonly Point[],
  opts: { sampleM?: number } = {},
): { meanM: number; maxM: number } {
  const sampleM = opts.sampleM ?? DEV_SAMPLE_M
  const routeSamples = resample(metricRoute, sampleM, false)
  const ringSamples = resample(metricRing, sampleM, true)

  let sum = 0
  let max = 0
  let n = 0
  for (const p of routeSamples) {
    const d = nearestOnPolyline(p, metricRing, true)
    sum += d
    if (d > max) max = d
    n++
  }
  for (const p of ringSamples) {
    const d = nearestOnPolyline(p, metricRoute, false)
    sum += d
    if (d > max) max = d
    n++
  }
  return { meanM: n === 0 ? 0 : sum / n, maxM: max }
}

/**
 * Combined stats for the panel, or `null` when there is nothing meaningful to
 * measure (fewer than two route points, or a zero-length route).
 */
export function routeStats(
  metricRoute: readonly Point[],
  metricRing: readonly Point[],
): RouteStats | null {
  if (metricRoute.length < 2 || metricRing.length < 2) return null
  const lengthM = routeLengthM(metricRoute)
  if (lengthM === 0) return null
  const { meanM, maxM } = routeDeviation(metricRoute, metricRing)
  return { lengthM, meanDeviationM: meanM, maxDeviationM: maxM }
}
