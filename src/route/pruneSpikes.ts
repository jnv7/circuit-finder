// Phase 22, stage 3: greedily drop waypoints whose removal makes the loop
// resemble the circuit *more*, not less — cleans up the out-and-back
// excursions the closed-loop Viterbi cannot see (it only scores consecutive
// pairs, so a detour that comes straight back the way it came never shows up
// as a bad transition). See docs/specs/phase-22-route-generator.md.
//
// This is a whole-recompute-per-candidate implementation, not the spec's
// "re-evaluate only the two affected legs" incremental design — the spec
// itself names this as the acceptable fallback ("if that design is not
// ready, ... pruning only the 3 best routes per tier") when an exact
// incremental version isn't ready; see the ROADMAP decision log for this
// phase. `generate-route.ts` applies that fallback by only running this stage
// on each tier's top few pose candidates.
import type { Point } from '../geometry/types'
import type { NodeId, StreetGraph } from '../graph'
import { buildLoopFromNodes } from './mapMatch'
import { computeRouteMetrics, barTermSum, DEFAULT_BAR } from './metrics'
import type { Bar } from './metrics'

/** Greedy removal passes, at most. */
export const PRUNE_PASSES = 3
/** Never prune a loop below this many waypoints. */
export const MIN_WAYPOINTS = 6

export type PruneSpikesOptions = {
  passes?: number
  minWaypoints?: number
  bar?: Bar
}

/**
 * Greedily drop waypoints from the closed node sequence `nodeIds` when doing
 * so lowers the sum of the acceptance-bar terms (mean/max deviation, length
 * ratio, retraced fraction) against `placedRingM`. Each pass walks the
 * current sequence once, left to right, committing the first improving
 * removal it finds at each position (not necessarily the single best one —
 * a later pass gets another chance at whatever a pass in order left behind);
 * stops early once a pass removes nothing, or at `minWaypoints`.
 */
export function pruneSpikes(
  nodeIds: readonly NodeId[],
  graph: StreetGraph,
  placedRingM: readonly Point[],
  circuitLengthM: number,
  scale: number,
  opts: PruneSpikesOptions = {},
): NodeId[] {
  const passes = opts.passes ?? PRUNE_PASSES
  const minWaypoints = opts.minWaypoints ?? MIN_WAYPOINTS
  const bar = opts.bar ?? DEFAULT_BAR

  function score(nodes: readonly NodeId[]): number {
    const { points, legs } = buildLoopFromNodes(nodes, graph)
    const metrics = computeRouteMetrics(points, legs, placedRingM, circuitLengthM, scale, graph)
    return barTermSum(metrics, bar)
  }

  let current = [...nodeIds]
  let currentScore = score(current)

  for (let pass = 0; pass < passes; pass++) {
    if (current.length <= minWaypoints) break
    let removedThisPass = false
    let i = 0
    while (i < current.length && current.length > minWaypoints) {
      const candidate = [...current.slice(0, i), ...current.slice(i + 1)]
      const candidateScore = score(candidate)
      if (candidateScore < currentScore) {
        current = candidate
        currentScore = candidateScore
        removedThisPass = true
        // Don't advance i: the next element has shifted into this position.
      } else {
        i++
      }
    }
    if (!removedThisPass) break
  }

  return current
}
