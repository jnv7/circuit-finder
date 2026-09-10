// Turning function of a polyline: the cumulative signed change of heading as you
// walk along it. Two shapes with a similar turning function have a similar
// outline regardless of where they sit or how big they are, which is what the
// Phase 6 placement search compares. All pure, metric space, radians CCW.
import type { Path, Point } from './types'
import { angleBetween } from './vector'

/**
 * Cumulative signed turning angle (radians) at each segment of `path`, starting
 * at 0 for the first segment and adding the exterior angle at each joint after
 * it. With `closed`, the last → first segment is included; otherwise it is not.
 * Result length is `path.length` when `closed`, else `path.length - 1`.
 */
export function cumulativeTurning(path: Path, closed = false): number[] {
  const n = path.length
  const segCount = closed ? n : n - 1
  if (segCount < 1) return []

  const dir = (i: number): Point => {
    const a = path[i % n]!
    const b = path[(i + 1) % n]!
    return [b[0] - a[0], b[1] - a[1]]
  }

  const out: number[] = [0]
  let acc = 0
  for (let i = 1; i < segCount; i++) {
    acc += angleBetween(dir(i - 1), dir(i))
    out.push(acc)
  }
  return out
}

/**
 * RMS of `a[i] - b[i]` after removing the mean difference, so a constant heading
 * offset between the two turning functions does not count. `a` and `b` must be
 * the same length (same sample count, same start, same orientation).
 */
export function turningDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('turningDistance: inputs differ in length')
  const n = a.length
  if (n === 0) return 0

  let meanDiff = 0
  for (let i = 0; i < n; i++) meanDiff += a[i]! - b[i]!
  meanDiff /= n

  let sum = 0
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]! - meanDiff
    sum += d * d
  }
  return Math.sqrt(sum / n)
}
