// Point-to-segment geometry, in metric space. Pure.
import type { Point } from './types'
import { distance } from './vector'

/**
 * Foot of the perpendicular from `p` onto segment `a`-`b`, clamped to the
 * segment. Returns `a` for a degenerate (zero-length) segment.
 */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return a
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return [a[0] + t * dx, a[1] + t * dy]
}

/** Distance from `p` to the nearest point of segment `a`-`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b))
}
