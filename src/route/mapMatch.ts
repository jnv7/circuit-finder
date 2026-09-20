// Phase 22, stage 2: resolve one candidate pose into an actual closed route on
// the real street graph. Samples the placed circuit every `stepM`, gathers up
// to `candidatesPerSample` graph nodes near each sample (restricted to the
// graph's main connected component — see `graph.ts`'s `componentOf`), and
// picks one node per sample with a **closed-loop Viterbi**: the joint choice
// that minimises total emission (how far each chosen node is from its
// sample) plus transition cost (how much the real shortest path between
// consecutive choices over- or under-shoots the geometric sample spacing).
// This is the piece Phase 14's `resolveLandmark` lacked — each landmark
// there picks its own best street independently, unaware of what a neighbour
// already claimed (see the Phase 21 rejection's diagnosis). See
// docs/specs/phase-22-route-generator.md.
import { joinWaypoints } from '../app/trace'
import type { RouteLeg } from '../app/trace'
import { resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import { distance } from '../geometry/vector'
import type { NodeId, StreetGraph } from '../graph'

/** Sample spacing along the placed circuit, metres. */
export const MATCH_STEP_M = 50
/** Candidate search radius per sample, metres. */
export const MATCH_RADIUS_M = 90
/** Candidate nodes kept per sample, at most. */
export const MATCH_CANDIDATES = 8
/** Kept candidates must be at least this far apart (diversity, not clumping
 *  on one busy junction's many close-together nodes). */
export const MATCH_MIN_SEP_M = 30
/** Emission cost = `(distanceM / EMISSION_SCALE_M) ** 2`. */
export const EMISSION_SCALE_M = 70
/** Transition cost weights: `TRANS_WEIGHT` on the shortest path's excess over
 *  the geometric step (as a fraction of the step), `TRANS_DEFICIT` on the
 *  (rarer) case it undershoots, capped at `TRANS_CAP` either way. */
export const TRANS_WEIGHT = 3
export const TRANS_CAP = 10
export const TRANS_DEFICIT = 0.3
/** Candidate pairs farther apart (straight line) than this multiple of the
 *  step are never even offered a shortest-path lookup — obviously not a real
 *  consecutive hop, and `shortestPath` is comparatively expensive. */
export const MAX_HOP_FACTOR = 3

export type MapMatchOptions = {
  stepM?: number
  radiusM?: number
  candidatesPerSample?: number
  minSepM?: number
  emissionScaleM?: number
  transWeight?: number
  transCap?: number
  transDeficit?: number
  maxHopFactor?: number
}

export type MapMatchResult = {
  /** One graph node per sample, in order — the last connects back to the
   *  first (a closed loop), not repeated in this list. */
  nodeIds: NodeId[]
}

type Candidate = { node: NodeId; point: Point; distanceM: number }

/** A uniform grid over the graph's main-component node positions, for
 *  radius-bounded candidate queries — built once per graph and reused across
 *  every pose a generator run tries, instead of re-scanning all nodes per
 *  sample. */
function buildMainComponentNodeGrid(
  graph: StreetGraph,
  cellM: number,
): { near(p: Point, maxM: number): NodeId[] } {
  const cells = new Map<string, NodeId[]>()
  const key = (cx: number, cy: number): string => `${cx},${cy}`
  for (let id = 0; id < graph.nodeCount; id++) {
    if (graph.componentOf(id) !== graph.mainComponent) continue
    const p = graph.nodePosition(id)
    const k = key(Math.floor(p[0] / cellM), Math.floor(p[1] / cellM))
    const bucket = cells.get(k)
    if (bucket) bucket.push(id)
    else cells.set(k, [id])
  }
  return {
    near(p, maxM) {
      const out: NodeId[] = []
      const cx0 = Math.floor((p[0] - maxM) / cellM)
      const cx1 = Math.floor((p[0] + maxM) / cellM)
      const cy0 = Math.floor((p[1] - maxM) / cellM)
      const cy1 = Math.floor((p[1] + maxM) / cellM)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const bucket = cells.get(key(cx, cy))
          if (bucket) out.push(...bucket)
        }
      }
      return out
    },
  }
}

export type MapMatcher = {
  /** Resolve a placed, closed ring (Porto-frame metres) into a matched node
   *  sequence, or `null` if some sample has no candidate within radius — an
   *  honest "cannot", never a guess. */
  matchLoop(placedRingM: readonly Point[]): MapMatchResult | null
}

/** Build a matcher once per graph (and reused across every pose a generator
 *  run tries — the expensive part, the node grid, is built exactly once). */
export function buildMapMatcher(graph: StreetGraph, opts: MapMatchOptions = {}): MapMatcher {
  const stepM = opts.stepM ?? MATCH_STEP_M
  const radiusM = opts.radiusM ?? MATCH_RADIUS_M
  const candidatesPerSample = opts.candidatesPerSample ?? MATCH_CANDIDATES
  const minSepM = opts.minSepM ?? MATCH_MIN_SEP_M
  const emissionScaleM = opts.emissionScaleM ?? EMISSION_SCALE_M
  const transWeight = opts.transWeight ?? TRANS_WEIGHT
  const transCap = opts.transCap ?? TRANS_CAP
  const transDeficit = opts.transDeficit ?? TRANS_DEFICIT
  const maxHopFactor = opts.maxHopFactor ?? MAX_HOP_FACTOR
  const maxHopM = stepM * maxHopFactor

  const grid = buildMainComponentNodeGrid(graph, Math.max(radiusM, 1))

  function candidatesFor(p: Point): Candidate[] {
    const nearby = grid
      .near(p, radiusM)
      .map((node) => ({ node, point: graph.nodePosition(node), distanceM: distance(p, graph.nodePosition(node)) }))
      .filter((c) => c.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM)

    const kept: Candidate[] = []
    for (const c of nearby) {
      if (kept.length >= candidatesPerSample) break
      if (kept.some((k) => distance(k.point, c.point) < minSepM)) continue
      kept.push(c)
    }
    return kept
  }

  const transitionCache = new Map<string, number>()
  function transitionCost(a: NodeId, b: NodeId): number {
    if (a === b) return 0
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const cached = transitionCache.get(key)
    if (cached !== undefined) return cached
    const straightM = distance(graph.nodePosition(a), graph.nodePosition(b))
    let cost: number
    if (straightM > maxHopM) {
      cost = Infinity
    } else {
      const path = graph.shortestPath(a, b)
      if (!path) {
        cost = Infinity
      } else {
        const excessRatio = Math.max(0, path.lengthM - stepM) / stepM
        const deficitRatio = Math.max(0, stepM - path.lengthM) / stepM
        cost = Math.min(transCap, transWeight * excessRatio + transDeficit * deficitRatio)
      }
    }
    transitionCache.set(key, cost)
    return cost
  }

  function emissionCost(distanceM: number): number {
    return (distanceM / emissionScaleM) ** 2
  }

  function matchLoop(placedRingM: readonly Point[]): MapMatchResult | null {
    const samples = resample(placedRingM, stepM, true)
    const n = samples.length
    const states: Candidate[][] = samples.map((p) => candidatesFor(p))
    if (states.some((s) => s.length === 0)) return null

    let bestTotal = Infinity
    let bestPath: NodeId[] | null = null

    // Closed loop: try each candidate at sample 0 as the fixed start/end,
    // run a standard forward Viterbi across the rest, then close the loop
    // back to that same fixed choice. `candidatesPerSample` is small (<= 8),
    // so this is <= 8 ordinary Viterbi passes, not an exponential search.
    for (const start of states[0]!) {
      const dp: number[][] = [[0]]
      const back: number[][] = [[]]
      for (let i = 1; i < n; i++) {
        const prevStates = i === 1 ? [start] : states[i - 1]!
        const prevDp = dp[i - 1]!
        const curStates = states[i]!
        const curDp: number[] = new Array(curStates.length).fill(Infinity)
        const curBack: number[] = new Array(curStates.length).fill(-1)
        for (let ci = 0; ci < curStates.length; ci++) {
          const emission = emissionCost(curStates[ci]!.distanceM)
          for (let pi = 0; pi < prevStates.length; pi++) {
            const trans = transitionCost(prevStates[pi]!.node, curStates[ci]!.node)
            if (trans === Infinity) continue
            const total = prevDp[pi]! + trans + emission
            if (total < curDp[ci]!) {
              curDp[ci] = total
              curBack[ci] = pi
            }
          }
        }
        dp.push(curDp)
        back.push(curBack)
      }

      const lastStates = n === 1 ? [start] : states[n - 1]!
      const lastDp = dp[n - 1]!
      for (let li = 0; li < lastStates.length; li++) {
        const closing = transitionCost(lastStates[li]!.node, start.node)
        if (closing === Infinity) continue
        const total = lastDp[li]! + closing
        if (total < bestTotal) {
          // Backtrack this hypothesis's path.
          const path: NodeId[] = new Array(n)
          path[0] = start.node
          let idx = li
          for (let i = n - 1; i >= 1; i--) {
            path[i] = states[i]![idx]!.node
            idx = back[i]![idx]!
          }
          bestTotal = total
          bestPath = path
        }
      }
    }

    return bestPath ? { nodeIds: bestPath } : null
  }

  return { matchLoop }
}

/** Join a closed node sequence leg by leg (real shortest path between every
 *  consecutive pair, wrapping the last back to the first) — the shared step
 *  every stage after map matching (spike pruning, metrics) needs to turn a
 *  node sequence into an actual polyline. */
export function buildLoopFromNodes(
  nodeIds: readonly NodeId[],
  graph: StreetGraph,
): { points: Point[]; legs: RouteLeg[] } {
  const waypoints = nodeIds.map((id) => graph.nodePosition(id))
  waypoints.push(waypoints[0]!)
  const nodes: NodeId[] = [...nodeIds, nodeIds[0]!]
  return joinWaypoints(waypoints, nodes, graph)
}
