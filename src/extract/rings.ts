// Finding a circuit's lap among OSM ways (Phase 24). Ways are cut into
// segments at every node they share, the segments form a graph, and every
// simple cycle of that graph is a candidate lap. The lap is then chosen by
// comparing each cycle's length with the official one — or, when that cannot
// decide, not chosen at all (the caller lists the candidates).
//
// One rule covers a per-layout relation, a multi-layout relation and a single
// closed way alike, because none of them is assumed: the cycles are found, then
// measured.
import type { LonLat } from '../geo'
import { projectRing } from '../geo'
import { distanceToSegment } from '../geometry/nearest'
import { pathLength, resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import type { OsmWay } from './overpass'

/** Endpoint gap tolerated between two ways that share no node id (reported when used).
 *  A dedicated racetrack's own `highway=raceway` way is normally one continuous
 *  line (gap 0); a street circuit's lap, assembled from ordinary named streets
 *  via its OSM route relation, can have real joints wider than this default —
 *  `extract-circuit --stitch-tolerance-m` overrides it per run. */
export const STITCH_FALLBACK_M = 5
/** Cap on enumerated cycles; exceeding it is a loud failure, not a truncated search. */
export const MAX_CYCLES = 5000
/** Cap on search steps, so a dense mesh fails loudly instead of hanging. */
export const MAX_STEPS = 3_000_000
/** The best ring must be within this fraction of the official length to be picked. */
export const PICK_TOLERANCE = 0.05
/** The runner-up must be at least this much (as a length fraction) worse. */
export const PICK_MARGIN = 0.03

/** Thrown by `findRings` when the way graph has too many simple cycles to
 *  enumerate (`MAX_CYCLES`) or search (`MAX_STEPS`) — almost always because an
 *  alternate/short layout shares pavement with the main lap at several points,
 *  not because the main lap itself is complex. `findJunctionOffenders` on the
 *  same ways usually names the culprit directly. */
export class TooManyCyclesError extends Error {}

export type RingCandidate = {
  wayIds: number[]
  /** Open ring of [lon, lat]: the first point is not repeated at the end. */
  points: LonLat[]
  lengthM: number
  /** Metres of each gap bridged by the endpoint-tolerance fallback (empty when every join shared a node). */
  bridgedGapsM: number[]
  /** True when every way of the ring is a member of the circuit's wikidata-tagged relation. */
  allInRelation: boolean
}

export type RankedRing = RingCandidate & {
  errorRatio: number
  /** Rings collapsed into this one because they follow the same lap to within `EQUIVALENT_M`. */
  equivalentCount?: number
}

/**
 * Two rings that stay within this many metres of each other everywhere are the
 * same lap for this tool's purpose: a centreline to place on Porto's streets,
 * judged against a bar that already tolerates a 100 m worst deviation. Measured
 * on the 2026-09-28 reproduction check: Hungaroring's two near-equal rings are
 * 22 m apart, Catalunya's five (identical length) 37–57 m apart, Monza's
 * chicane variants closer still.
 */
export const EQUIVALENT_M = 60
/** Sample spacing for that comparison. */
const EQUIVALENT_SAMPLE_M = 10

type Segment = { wayId: number; nodeIds: number[]; points: LonLat[]; from: number; to: number }

/** Cut every way at each node that is a junction (used twice) or an end of the way. */
function buildSegments(ways: readonly OsmWay[]): Segment[] {
  const uses = new Map<number, number>()
  for (const w of ways) for (const n of w.nodeIds) uses.set(n, (uses.get(n) ?? 0) + 1)
  const segments: Segment[] = []
  for (const w of ways) {
    let start = 0
    for (let i = 1; i < w.nodeIds.length; i++) {
      const isCut = i === w.nodeIds.length - 1 || (uses.get(w.nodeIds[i]!) ?? 0) >= 2
      if (!isCut) continue
      segments.push({
        wayId: w.id,
        nodeIds: w.nodeIds.slice(start, i + 1),
        points: w.points.slice(start, i + 1),
        from: w.nodeIds[start]!,
        to: w.nodeIds[i]!,
      })
      start = i
    }
  }
  return segments
}

/** Union-find over node ids, so nearby dangling ends can be treated as one vertex. */
class Joins {
  private parent = new Map<number, number>()
  find(x: number): number {
    let root = x
    while (this.parent.has(root)) root = this.parent.get(root)!
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/** Metres between two nearby [lon, lat] points (equirectangular; exact enough at bridging scale). */
function gapM(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * 111_320
  const dLon = (b[0] - a[0]) * 111_320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot(dLat, dLon)
}

/** Pair up dangling segment ends (used by a single segment) that lie within the fallback tolerance. */
function findBridges(segments: readonly Segment[], toleranceM: number): Array<[number, number]> {
  const degree = new Map<number, number>()
  const position = new Map<number, LonLat>()
  for (const s of segments) {
    for (const [node, p] of [[s.from, s.points[0]!], [s.to, s.points[s.points.length - 1]!]] as const) {
      degree.set(node, (degree.get(node) ?? 0) + 1)
      position.set(node, p)
    }
  }
  const dangling = [...degree.entries()].filter(([, d]) => d === 1).map(([n]) => n)
  const bridges: Array<[number, number]> = []
  for (let i = 0; i < dangling.length; i++) {
    for (let j = i + 1; j < dangling.length; j++) {
      if (gapM(position.get(dangling[i]!)!, position.get(dangling[j]!)!) <= toleranceM) {
        bridges.push([dangling[i]!, dangling[j]!])
      }
    }
  }
  return bridges
}

/**
 * Every simple cycle of the way graph, as candidate laps. Throws
 * `TooManyCyclesError` when the graph is too tangled to enumerate within
 * `maxCycles` cycles / `MAX_STEPS` steps — the caller should run
 * `findJunctionOffenders` on the same `ways` and tell the operator to pin
 * the lap with `--exclude-ways`.
 */
export function findRings(ways: readonly OsmWay[], maxCycles = MAX_CYCLES, stitchToleranceM = STITCH_FALLBACK_M): RingCandidate[] {
  const segments = buildSegments(ways)
  const joins = new Joins()
  for (const [a, b] of findBridges(segments, stitchToleranceM)) joins.union(a, b)
  const inRelation = new Map(ways.map((w) => [w.id, w.inRelation]))

  const vertexIndex = new Map<number, number>()
  const vertexOf = (node: number): number => {
    const root = joins.find(node)
    let idx = vertexIndex.get(root)
    if (idx === undefined) {
      idx = vertexIndex.size
      vertexIndex.set(root, idx)
    }
    return idx
  }
  const edges = segments.map((s) => ({ seg: s, u: vertexOf(s.from), v: vertexOf(s.to) }))
  const adjacency: Array<Array<{ edge: number; other: number }>> = Array.from({ length: vertexIndex.size }, () => [])
  const cycles: Array<{ start: number; edgeIds: number[] }> = []
  const pushCycle = (start: number, edgeIds: number[]): void => {
    cycles.push({ start, edgeIds })
    if (cycles.length > maxCycles) {
      throw new TooManyCyclesError(
        `more than ${maxCycles} candidate laps: too many layouts overlap here — pin the lap with --exclude-ways`,
      )
    }
  }
  edges.forEach((e, i) => {
    if (e.u === e.v) pushCycle(e.u, [i]) // a closed way (or one closed by a bridged gap) is a lap by itself
    else {
      adjacency[e.u]!.push({ edge: i, other: e.v })
      adjacency[e.v]!.push({ edge: i, other: e.u })
    }
  })

  let steps = 0
  const visited = new Array<boolean>(vertexIndex.size).fill(false)
  const usedEdges = new Set<number>()
  const path: number[] = []
  const walk = (at: number, start: number): void => {
    for (const { edge, other } of adjacency[at]!) {
      if (++steps > MAX_STEPS) {
        throw new TooManyCyclesError(`the way graph is too tangled to search (over ${MAX_STEPS} steps) — pin the lap with --exclude-ways`)
      }
      if (usedEdges.has(edge)) continue
      if (other === start) {
        // Each undirected cycle is met in both directions; keep the one whose first edge id is smaller.
        if (path[0]! < edge) pushCycle(start, [...path, edge])
        continue
      }
      if (other < start || visited[other]) continue
      visited[other] = true
      usedEdges.add(edge)
      path.push(edge)
      walk(other, start)
      path.pop()
      usedEdges.delete(edge)
      visited[other] = false
    }
  }
  for (let s = 0; s < adjacency.length; s++) {
    visited[s] = true
    // Seed the walk with each first edge so `path[0]` is defined when a cycle closes.
    for (const { edge, other } of adjacency[s]!) {
      if (other < s) continue
      visited[other] = true
      usedEdges.add(edge)
      path.push(edge)
      walk(other, s)
      path.pop()
      usedEdges.delete(edge)
      visited[other] = false
    }
    visited[s] = false
  }

  return cycles.map((c) => toRing(c.start, c.edgeIds, edges, inRelation))
}

export type JunctionOffender = { wayId: number; name?: string; junctionCount: number }

/**
 * Diagnostic for a `TooManyCyclesError`: which ways are most responsible for
 * the branching. A junction here is any node touched by `minWays` or more
 * ways; a lap's own segments each touch only the one or two junctions linking
 * them to their neighbours, but a separate layout sharing pavement with the
 * main lap (a short/alternate circuit, a karting track, a paddock loop) tends
 * to cross it repeatedly, so its way shows up in far more junctions than any
 * genuine lap segment — real example: Circuit of the Americas' "COTA Short
 * Track" way touches 26 of the 36 raceway-tagged ways' junctions, where every
 * "Turn N" segment of the Grand Prix lap touches 2-4. Sorted worst first;
 * empty when nothing stands out (every way touches at most `minWays - 1`
 * junctions with others, i.e. the ways form a simple path/cycle already).
 */
export function findJunctionOffenders(ways: readonly OsmWay[], minWays = 3): JunctionOffender[] {
  const nodeWays = new Map<number, Set<number>>()
  for (const w of ways) {
    for (const n of w.nodeIds) {
      let set = nodeWays.get(n)
      if (!set) {
        set = new Set()
        nodeWays.set(n, set)
      }
      set.add(w.id)
    }
  }
  const junctionCount = new Map<number, number>()
  for (const wset of nodeWays.values()) {
    if (wset.size < minWays) continue
    for (const id of wset) junctionCount.set(id, (junctionCount.get(id) ?? 0) + 1)
  }
  const byId = new Map(ways.map((w) => [w.id, w]))
  return [...junctionCount.entries()]
    .map(([wayId, count]) => ({ wayId, name: byId.get(wayId)?.tags['name'], junctionCount: count }))
    .sort((a, b) => b.junctionCount - a.junctionCount)
}

/** Assemble a cycle's edges into one open ring of points. */
function toRing(
  start: number,
  edgeIds: readonly number[],
  edges: ReadonlyArray<{ seg: Segment; u: number; v: number }>,
  inRelation: ReadonlyMap<number, boolean>,
): RingCandidate {
  const points: LonLat[] = []
  const nodeIds: number[] = []
  const wayIds: number[] = []
  const bridged: number[] = []
  const noteGap = (a: LonLat, b: LonLat): void => {
    const gap = gapM(a, b)
    if (gap > 0.01) bridged.push(Math.round(gap * 100) / 100)
  }

  // Walk the edges in order, orienting each so it starts at the vertex the walk is at.
  let at = start
  for (const id of edgeIds) {
    const { seg, u, v } = edges[id]!
    const forward = u === at
    const ids = forward ? seg.nodeIds : [...seg.nodeIds].reverse()
    const pts = forward ? seg.points : [...seg.points].reverse()
    at = forward ? v : u
    if (nodeIds.length > 0 && ids[0] !== nodeIds[nodeIds.length - 1]) noteGap(points[points.length - 1]!, pts[0]!)
    for (let i = 0; i < ids.length; i++) {
      if (i === 0 && ids[0] === nodeIds[nodeIds.length - 1]) continue
      nodeIds.push(ids[i]!)
      points.push(pts[i]!)
    }
    if (!wayIds.includes(seg.wayId)) wayIds.push(seg.wayId)
  }
  // Closing joint: the ring must not repeat its first point; a different node here is a bridged gap.
  if (nodeIds.length > 1 && nodeIds[nodeIds.length - 1] === nodeIds[0]) {
    points.pop()
  } else if (points.length > 1) {
    noteGap(points[points.length - 1]!, points[0]!)
  }
  const ring = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1])
  if (ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring.pop()

  return {
    wayIds,
    points: ring,
    lengthM: pathLength(projectRing(ring).points, true),
    bridgedGapsM: bridged,
    allInRelation: wayIds.every((w) => inRelation.get(w) === true),
  }
}

/** Rank rings by how close their length is to the official one (closest first). */
export function rankRings(rings: readonly RingCandidate[], officialLengthM: number): RankedRing[] {
  return rings
    .map((r) => ({ ...r, errorRatio: Math.abs(r.lengthM / officialLengthM - 1) }))
    .sort(
      (a, b) =>
        a.errorRatio - b.errorRatio ||
        a.bridgedGapsM.length - b.bridgedGapsM.length ||
        Number(b.allInRelation) - Number(a.allInRelation),
    )
}

function maxDeviationM(from: readonly Point[], to: readonly Point[], stopAbove: number): number {
  let worst = 0
  for (const p of from) {
    let nearest = Infinity
    for (let i = 0; i < to.length; i++) {
      nearest = Math.min(nearest, distanceToSegment(p, to[i]!, to[(i + 1) % to.length]!))
      if (nearest <= worst) break // cannot raise the maximum
    }
    worst = Math.max(worst, nearest)
    if (worst > stopAbove) return worst
  }
  return worst
}

/**
 * True when two rings follow the same lap: every sample of each lies within
 * `toleranceM` of the other. A chicane variant or a doubled-up way changes a
 * ring's composition and length by a few metres without changing the lap.
 */
export function sameLap(a: RingCandidate, b: RingCandidate, toleranceM = EQUIVALENT_M): boolean {
  if (a.points.length < 3 || b.points.length < 3) return false
  const { points } = projectRing([...a.points, ...b.points])
  const pa = resample(points.slice(0, a.points.length), EQUIVALENT_SAMPLE_M, true)
  const pb = resample(points.slice(a.points.length), EQUIVALENT_SAMPLE_M, true)
  return maxDeviationM(pa, pb, toleranceM) <= toleranceM && maxDeviationM(pb, pa, toleranceM) <= toleranceM
}

/**
 * Collapse, among the rings that could compete for the pick (those within
 * `PICK_MARGIN` of the best), the ones that follow the same lap. The
 * representative is the first in rank order — or a relation-only twin when the
 * first is not one. Rings beyond that window are left as they are.
 */
export function collapseEquivalent(ranked: readonly RankedRing[], toleranceM = EQUIVALENT_M): RankedRing[] {
  const best = ranked[0]
  if (!best) return []
  const windowSize = ranked.findIndex((r) => r.errorRatio - best.errorRatio >= PICK_MARGIN)
  const window = windowSize < 0 ? ranked : ranked.slice(0, windowSize)
  const kept: RankedRing[] = []
  for (const ring of window) {
    const at = kept.findIndex((k) => sameLap(k, ring, toleranceM))
    if (at < 0) {
      kept.push({ ...ring, equivalentCount: ring.equivalentCount ?? 0 })
      continue
    }
    const twin = kept[at]!
    const count = (twin.equivalentCount ?? 0) + 1 + (ring.equivalentCount ?? 0)
    kept[at] = !twin.allInRelation && ring.allInRelation ? { ...ring, equivalentCount: count } : { ...twin, equivalentCount: count }
  }
  return [...kept, ...ranked.slice(window.length)]
}

export type PickResult =
  | { kind: 'picked'; ring: RankedRing; note?: string }
  | { kind: 'ambiguous'; top: RankedRing[] }
  | { kind: 'none'; reason: string }

/**
 * Choose the lap only when the length check can vouch for it: the best ring is
 * within `PICK_TOLERANCE` of the official length and the next *different* lap is
 * at least `PICK_MARGIN` worse (rings that follow the same lap to within
 * `EQUIVALENT_M` count as one). When near-equal different laps remain, the best
 * still wins if it alone is made entirely of the members of the circuit's own
 * `wikidata`-tagged relation — the mapper's statement of what the circuit is —
 * and the result says so. Anything else is a refusal the caller reports.
 */
export function pickRing(ranked: readonly RankedRing[]): PickResult {
  const distinct = collapseEquivalent(ranked)
  const best = distinct[0]
  if (!best) return { kind: 'none', reason: 'no closed ring could be formed from the ways found' }
  if (best.errorRatio > PICK_TOLERANCE) {
    return {
      kind: 'none',
      reason:
        `the closest ring is ${(best.errorRatio * 100).toFixed(1)}% off the official length ` +
        `(limit ${PICK_TOLERANCE * 100}%)`,
    }
  }
  const notes: string[] = []
  if ((best.equivalentCount ?? 0) > 0) {
    notes.push(`${best.equivalentCount} other ring(s) follow the same lap to within ${EQUIVALENT_M} m and were collapsed into it`)
  }
  const rivals = distinct.slice(1).filter((r) => r.errorRatio - best.errorRatio < PICK_MARGIN)
  if (rivals.length === 0) return { kind: 'picked', ring: best, ...(notes.length ? { note: notes.join('; ') } : {}) }
  if (best.allInRelation && rivals.every((r) => !r.allInRelation)) {
    notes.push(
      `${rivals.length} different lap(s) are within ${PICK_MARGIN * 100} points of its length; ` +
        `chosen because it alone consists only of the circuit's own OSM relation members`,
    )
    return { kind: 'picked', ring: best, note: notes.join('; ') }
  }
  return { kind: 'ambiguous', top: distinct.slice(0, 5) }
}
