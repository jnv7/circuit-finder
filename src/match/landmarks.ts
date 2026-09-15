// Phase 14: a skeleton the user can adjust, instead of either a blank map or a
// forced rigid loop. Reduces the circuit to its significant corners
// (`geometry/corners.ts`), resolves each one *independently* against the real
// street network within its own bounded radius — no single rigid transform
// has to get every corner right at once — and routes between consecutive
// resolved corners with the existing graph A*. Unresolved corners and
// unconnected legs are honest gaps, reusing `RouteLeg`/`joinWaypoints` exactly
// as manual tracing already does. See
// docs/specs/phase-14-corner-anchored-placement.md.
import { joinWaypoints, routeDeviation } from '../app/trace'
import type { RouteLeg } from '../app/trace'
import { extractCorners } from '../geometry/corners'
import type { ExtractCornersOptions } from '../geometry/corners'
import { pathLength } from '../geometry/path'
import type { Point } from '../geometry/types'
import { rotate as rotateVec, scale as scaleVec } from '../geometry/vector'
import type { NodeId, StreetGraph } from '../graph'
import { ALIGN_MAX_RAD, localHeading } from './objective'
import type { Candidate, Landmark, LandmarkAnchor, SkeletonLoop } from './types'

export { ALIGN_MAX_RAD }

/** Turn angle below which a joint is resampling noise, not a real corner.
 *  Tuned against the three bundled circuits (see the ROADMAP decision log). */
export const MIN_TURN_RAD = 0.35
/** Corners closer than this are merged into one landmark, keeping the
 *  sharper one — models a chicane or corner complex as one point to place. */
export const MIN_CORNER_SPACING_M = 60
/** Per-landmark independent search radius: four times the old rigid-loop
 *  snap tolerance, since there are far fewer points to place and each one
 *  matters more. */
export const LANDMARK_SEARCH_RADIUS_M = 120

/** Place a circuit-frame point under a candidate pose (scale about the
 *  origin, then rotate, then translate) — the same placement math every
 *  other phase already uses, applied to one landmark point at a time. */
function placeCandidatePoint(p: Point, candidate: Candidate, scale: number): Point {
  const r = rotateVec(scaleVec(p, scale), candidate.rotationRad)
  return [r[0] + candidate.anchorM[0], r[1] + candidate.anchorM[1]]
}

/**
 * Every significant corner of the circuit's own outline, as landmarks with
 * their local heading rotated to `rotationRad`. Pure function of the
 * circuit's shape and orientation — independent of where it is anchored.
 */
export function buildLandmarks(
  circuitSamplesM: readonly Point[],
  rotationRad: number,
  opts?: ExtractCornersOptions,
): Landmark[] {
  const corners = extractCorners(circuitSamplesM, {
    minTurnRad: opts?.minTurnRad ?? MIN_TURN_RAD,
    minSpacingM: opts?.minSpacingM ?? MIN_CORNER_SPACING_M,
  })
  return corners.map((corner) => ({
    corner,
    heading: localHeading(circuitSamplesM, corner.index, rotationRad),
  }))
}

/**
 * Resolve one landmark for a given placement: its expected position (the
 * placement applied to the landmark's circuit-frame point), searched against
 * `graph` within `searchRadiusM` for a well-aligned real street point. `null`
 * point/node when nothing acceptable is in range — a gap, not a failure.
 */
export function resolveLandmark(
  landmark: Landmark,
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { searchRadiusM?: number; alignMaxRad?: number },
): LandmarkAnchor {
  const searchRadiusM = opts?.searchRadiusM ?? LANDMARK_SEARCH_RADIUS_M
  const alignMaxRad = opts?.alignMaxRad ?? ALIGN_MAX_RAD
  const expected = placeCandidatePoint(landmark.corner.point, candidate, scale)
  const resolved = graph.nearestAlignedPointM(expected, landmark.heading, searchRadiusM, alignMaxRad)
  return { landmark, point: resolved?.point ?? null, node: resolved?.node ?? null, retraceM: 0 }
}

/**
 * For every edge id used by more than one leg, every use beyond the first
 * counts its full length toward the total — the loop's honest "retraced, not
 * new ground" figure. `perLegM[i]` is leg `i`'s own share of that total: a
 * shared edge's length is split evenly across every leg that uses it, so
 * summing `perLegM` always reproduces `totalM` exactly, with no arbitrary
 * choice of which use was "the retrace" — a loop has no natural start.
 */
function computeRetraced(
  legs: readonly RouteLeg[],
  graph: StreetGraph,
): { totalM: number; perLegM: number[] } {
  const legIndicesByEdge = new Map<number, number[]>()
  legs.forEach((leg, i) => {
    for (const edgeId of leg.edgeIds) {
      const list = legIndicesByEdge.get(edgeId)
      if (list) list.push(i)
      else legIndicesByEdge.set(edgeId, [i])
    }
  })

  let totalM = 0
  const perLegM = legs.map(() => 0)
  for (const [edgeId, legIndices] of legIndicesByEdge) {
    if (legIndices.length < 2) continue
    const lengthM = graph.edgeLengthM(edgeId)
    const extraM = (legIndices.length - 1) * lengthM
    totalM += extraM
    const shareM = extraM / legIndices.length
    for (const i of legIndices) perLegM[i]! += shareM
  }
  return { totalM, perLegM }
}

/** Split each landmark's retraced share evenly between the two legs touching
 *  it (leg `i - 1` ends there, leg `i` starts there) — a shared edge's blame
 *  genuinely belongs to both ends of the leg that carries it, not one
 *  arbitrarily. */
function retraceMByAnchor(perLegM: readonly number[], anchorCount: number): number[] {
  return Array.from({ length: anchorCount }, (_, i) => {
    const before = perLegM[(i - 1 + anchorCount) % anchorCount]!
    const after = perLegM[i]!
    return (before + after) / 2
  })
}

/** Build a `SkeletonLoop` from resolved anchors + the placed reference ring:
 *  join every anchor leg by leg (an unresolved anchor's own placed/expected
 *  point stands in for it, so a gap leg still draws to the right place), and
 *  measure the result the same way the old best-effort loop did — length of
 *  the joined points, deviation against the placed corner ring. */
function buildLoop(anchors: LandmarkAnchor[], placedRingM: Point[], graph: StreetGraph): SkeletonLoop {
  const waypoints = anchors.map((a, i) => a.point ?? placedRingM[i]!)
  const nodes = anchors.map((a) => a.node)
  waypoints.push(waypoints[0]!)
  nodes.push(nodes[0]!)

  const { points, legs } = joinWaypoints(waypoints, nodes, graph)
  const gapCount = legs.filter((l) => !l.real).length
  const { meanM, maxM } = routeDeviation(points, placedRingM)
  const { totalM: retracedM, perLegM } = computeRetraced(legs, graph)
  const retraceMs = retraceMByAnchor(perLegM, anchors.length)
  const anchorsWithRetrace = anchors.map((a, i) => ({ ...a, retraceM: retraceMs[i]! }))

  return {
    anchors: anchorsWithRetrace,
    legs,
    lengthM: pathLength(points, false),
    meanDeviationM: meanM,
    maxDeviationM: maxM,
    gapCount,
    retracedM,
    placedRingM,
  }
}

/**
 * Resolve every landmark for `candidate` and join them leg by leg — the
 * corner-anchored replacement for the old rigid-pose best-effort loop.
 */
export function buildSkeletonLoop(
  landmarks: readonly Landmark[],
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { searchRadiusM?: number; alignMaxRad?: number },
): SkeletonLoop {
  const anchors = landmarks.map((lm) => resolveLandmark(lm, candidate, scale, graph, opts))
  const placedRingM = landmarks.map((lm) => placeCandidatePoint(lm.corner.point, candidate, scale))
  return buildLoop(anchors, placedRingM, graph)
}

/**
 * Replace one anchor's point/node (already resolved by the caller — e.g. a
 * drag snapped via `graph.nearestPointM`) and recompute only the two legs
 * touching it. `shortestPath` is cheap enough per call that recomputing a
 * whole skeleton per drag would be wasteful, not that it would be incorrect
 * — every other leg object is reused unchanged (referentially), only the
 * loop's totals (length/deviation/gap count) are freshly summed from the
 * updated leg list, which is cheap arithmetic, not a graph search.
 */
export function moveLandmark(
  loop: SkeletonLoop,
  index: number,
  point: Point,
  node: NodeId | null,
  graph: StreetGraph,
): SkeletonLoop {
  const n = loop.anchors.length
  const prevIdx = (index - 1 + n) % n
  const nextIdx = (index + 1) % n

  const anchors = loop.anchors.slice()
  anchors[index] = { ...anchors[index]!, point, node }

  const prevWaypoint = anchors[prevIdx]!.point ?? loop.placedRingM[prevIdx]!
  const nextWaypoint = anchors[nextIdx]!.point ?? loop.placedRingM[nextIdx]!

  const before = joinWaypoints([prevWaypoint, point], [anchors[prevIdx]!.node, node], graph).legs[0]!
  const after = joinWaypoints([point, nextWaypoint], [node, anchors[nextIdx]!.node], graph).legs[0]!

  const legs = loop.legs.slice()
  legs[prevIdx] = before
  legs[index] = after

  const points: Point[] = []
  for (const leg of legs) {
    if (points.length === 0) points.push(leg.points[0]!)
    for (let i = 1; i < leg.points.length; i++) points.push(leg.points[i]!)
  }
  const gapCount = legs.filter((l) => !l.real).length
  const { meanM, maxM } = routeDeviation(points, loop.placedRingM)
  const { totalM: retracedM, perLegM } = computeRetraced(legs, graph)
  const retraceMs = retraceMByAnchor(perLegM, n)
  const anchorsWithRetrace = anchors.map((a, i) => ({ ...a, retraceM: retraceMs[i]! }))

  return {
    anchors: anchorsWithRetrace,
    legs,
    lengthM: pathLength(points, false),
    meanDeviationM: meanM,
    maxDeviationM: maxM,
    gapCount,
    retracedM,
    placedRingM: loop.placedRingM,
  }
}
