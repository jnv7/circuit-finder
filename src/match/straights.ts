// Phase 12: seed placement candidates from real streets whose own longest
// straight is close in length to the circuit's own longest straight — the
// same reasoning a runner scans a map for by eye. See
// docs/specs/phase-12-anchor-on-real-streets.md.
import { longestStraight } from '../geometry/straight'
import type { Point } from '../geometry/types'
import { rotate } from '../geometry/vector'
import type { Street } from '../streets'
import type { Candidate } from './types'

export const MIN_STRAIGHT_RATIO = 0.6
export const MAX_STRAIGHT_RATIO = 1.6

export type StreetStraight = { a: Point; b: Point; lengthM: number; bearing: number }

/** Every bundled street's own longest straight run whose length, relative to
 *  `targetLengthM`, falls within `[MIN_STRAIGHT_RATIO, MAX_STRAIGHT_RATIO]`. */
export function findMatchingStreetStraights(
  ways: readonly Street[],
  targetLengthM: number,
): StreetStraight[] {
  const minLengthM = targetLengthM * MIN_STRAIGHT_RATIO
  const maxLengthM = targetLengthM * MAX_STRAIGHT_RATIO
  const matches: StreetStraight[] = []
  for (const way of ways) {
    if (way.length < 2) continue
    const straight = longestStraight(way, { closed: false })
    if (straight.lengthM < minLengthM || straight.lengthM > maxLengthM) continue
    matches.push({
      a: way[straight.startIndex]!,
      b: way[straight.endIndex]!,
      lengthM: straight.lengthM,
      bearing: straight.bearing,
    })
  }
  return matches
}

/** The two candidate poses (bearing, and its reverse) that place
 *  `circuitStraight`'s midpoint and bearing onto `streetStraight`'s. Both
 *  points are expected in the same (already-scaled) frame the resulting
 *  `Candidate` will be applied in — see `scoreCandidate`'s "scale, then
 *  rotate, then translate" transform. */
export function seedFromStraight(
  circuitStraight: { a: Point; b: Point },
  streetStraight: StreetStraight,
): [Candidate, Candidate] {
  const { a, b } = circuitStraight
  const circuitBearing = Math.atan2(b[1] - a[1], b[0] - a[0])
  const circuitMid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const streetMid: Point = [
    (streetStraight.a[0] + streetStraight.b[0]) / 2,
    (streetStraight.a[1] + streetStraight.b[1]) / 2,
  ]

  const makeCandidate = (targetBearing: number): Candidate => {
    const rotationRad = targetBearing - circuitBearing
    const rotatedMid = rotate(circuitMid, rotationRad)
    const anchorM: Point = [streetMid[0] - rotatedMid[0], streetMid[1] - rotatedMid[1]]
    return { anchorM, rotationRad }
  }

  return [makeCandidate(streetStraight.bearing), makeCandidate(streetStraight.bearing + Math.PI)]
}
