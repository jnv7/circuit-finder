// Longest near-straight detection along a path.
import type { Path, Point, Straight } from './types'

export type LongestStraightOptions = {
  /** Maximum turn allowed at an interior joint, in radians. Default ~6.9°. */
  maxTurnRad?: number
  /** Treat the path as a closed loop (include the last → first segment). */
  closed?: boolean
}

type Seg = { from: number; to: number; dir: Point; len: number }

function buildSegments(path: Path, closed: boolean): Seg[] {
  const n = path.length
  const last = closed ? n : n - 1
  const segs: Seg[] = []
  for (let i = 0; i < last; i++) {
    const from = i
    const to = (i + 1) % n
    const a = path[from]!
    const b = path[to]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    segs.push({ from, to, dir: len === 0 ? [0, 0] : [dx / len, dy / len], len })
  }
  return segs
}

/** Unsigned turn angle between two unit direction vectors, in [0, π]. */
function turn(a: Point, b: Point): number {
  const d = a[0] * b[0] + a[1] * b[1]
  return Math.acos(Math.min(1, Math.max(-1, d)))
}

/**
 * Find the longest run of consecutive segments whose every interior joint turns
 * by no more than `maxTurnRad`. For a closed path the search wraps across the
 * seam. Ties are broken by the lowest `startIndex`.
 */
export function longestStraight(path: Path, options: LongestStraightOptions = {}): Straight {
  const { maxTurnRad = 0.12, closed = true } = options
  if (path.length < 2) throw new Error('longestStraight: need at least 2 points')

  const segs = buildSegments(path, closed)
  const m = segs.length
  if (m === 1) {
    const s = segs[0]!
    return { startIndex: s.from, endIndex: s.to, lengthM: s.len, bearing: bearing(path, s.from, s.to) }
  }

  // Order in which to visit segments. For a closed path, start just after a
  // joint that already exceeds the tolerance so runs are not split by the seam.
  let order: number[]
  if (closed) {
    let brk = -1
    for (let j = 0; j < m; j++) {
      const prev = segs[(j - 1 + m) % m]!
      if (turn(prev.dir, segs[j]!.dir) > maxTurnRad) {
        brk = j
        break
      }
    }
    if (brk === -1) {
      // Essentially circular: the whole loop is one run.
      const lengthM = segs.reduce((sum, s) => sum + s.len, 0)
      return { startIndex: segs[0]!.from, endIndex: segs[m - 1]!.to, lengthM, bearing: segs[0] ? bearing(path, segs[0]!.from, segs[0]!.to) : 0 }
    }
    order = Array.from({ length: m }, (_, i) => (brk + i) % m)
  } else {
    order = Array.from({ length: m }, (_, i) => i)
  }

  let best: Straight | null = null
  let runStart = 0 // index into `order`
  for (let k = 0; k < order.length; k++) {
    if (k > runStart) {
      const prev = segs[order[k - 1]!]!
      const cur = segs[order[k]!]!
      if (turn(prev.dir, cur.dir) > maxTurnRad) {
        best = consider(best, path, segs, order, runStart, k - 1)
        runStart = k
      }
    }
  }
  best = consider(best, path, segs, order, runStart, order.length - 1)
  return best!
}

function consider(
  best: Straight | null,
  path: Path,
  segs: Seg[],
  order: number[],
  a: number,
  b: number,
): Straight {
  let lengthM = 0
  for (let k = a; k <= b; k++) lengthM += segs[order[k]!]!.len
  const startIndex = segs[order[a]!]!.from
  const endIndex = segs[order[b]!]!.to
  const candidate: Straight = { startIndex, endIndex, lengthM, bearing: bearing(path, startIndex, endIndex) }
  if (best === null) return candidate
  if (candidate.lengthM > best.lengthM + 1e-9) return candidate
  if (Math.abs(candidate.lengthM - best.lengthM) <= 1e-9 && candidate.startIndex < best.startIndex) return candidate
  return best
}

function bearing(path: Path, i: number, j: number): number {
  const a = path[i]!
  const b = path[j]!
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}
