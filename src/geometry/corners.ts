// Reduce a closed path to its significant corners: every joint whose turn
// exceeds a noise threshold, with nearby joints merged into one. The natural
// generalisation of `straight.ts`'s "find the longest near-straight run" to
// "find every joint that isn't part of any near-straight run" — shares its
// segment-direction machinery rather than duplicating it. See
// docs/specs/phase-14-corner-anchored-placement.md.
import { buildSegments, turn } from './straight'
import { distance } from './vector'
import type { Path, Point } from './types'

export type Corner = { index: number; point: Point; turnRad: number }

export type ExtractCornersOptions = {
  /** Turn angle below which a joint is resampling noise, not a real corner. Radians. */
  minTurnRad?: number
  /** Corners closer than this are merged, keeping the sharper one. Metres. */
  minSpacingM?: number
}

const DEFAULT_MIN_TURN_RAD = 0.35
const DEFAULT_MIN_SPACING_M = 60

/**
 * Every significant direction change in a closed path: joints whose turn
 * exceeds `minTurnRad`, with joints closer than `minSpacingM` merged (keeping
 * the sharper one). Order follows the path; a corner's `turnRad` is the
 * unsigned turn at that joint (same convention as `straight.ts`'s `turn`).
 * Returns `[]` for a ring with no joint sharp enough to count (e.g. a near-
 * circular shape) — not a crash, a documented "no corners" result.
 */
export function extractCorners(path: Path, opts: ExtractCornersOptions = {}): Corner[] {
  const minTurnRad = opts.minTurnRad ?? DEFAULT_MIN_TURN_RAD
  const minSpacingM = opts.minSpacingM ?? DEFAULT_MIN_SPACING_M
  const n = path.length
  if (n < 3) return []

  const segs = buildSegments(path, true)
  let corners: Corner[] = []
  for (let i = 0; i < n; i++) {
    const prev = segs[(i - 1 + n) % n]!
    const cur = segs[i]!
    const turnRad = turn(prev.dir, cur.dir)
    if (turnRad > minTurnRad) corners.push({ index: i, point: path[i]!, turnRad })
  }

  // Repeatedly merge the closest circularly-adjacent pair of corners while it
  // is within minSpacingM, keeping the sharper of the two — models a chicane
  // or corner complex as one landmark instead of several redundant ones.
  while (corners.length > 1) {
    let mergeAt = -1
    let bestDist = Infinity
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]!
      const b = corners[(i + 1) % corners.length]!
      const d = distance(a.point, b.point)
      if (d < bestDist) {
        bestDist = d
        mergeAt = i
      }
    }
    if (bestDist >= minSpacingM) break
    const i = mergeAt
    const j = (mergeAt + 1) % corners.length
    const a = corners[i]!
    const b = corners[j]!
    const kept = a.turnRad >= b.turnRad ? a : b
    corners = corners.filter((_, k) => k !== i && k !== j)
    corners.push(kept)
    corners.sort((x, y) => x.index - y.index)
  }

  return corners
}
