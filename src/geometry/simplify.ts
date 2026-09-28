// Douglas–Peucker polyline simplification. Used by the circuit-extraction
// tooling (Phase 24) to thin an OSM ring to the density `circuits.json` stores.
import { distanceToSegment } from './nearest'
import type { Path, Point } from './types'

/** Mark which of `path[lo..hi]` survive; both ends are always kept. */
function markKept(path: Path, lo: number, hi: number, toleranceM: number, keep: boolean[]): void {
  const stack: Array<[number, number]> = [[lo, hi]]
  while (stack.length > 0) {
    const [from, to] = stack.pop()!
    let worst = -1
    let worstDist = toleranceM
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(path[i]!, path[from]!, path[to]!)
      if (d > worstDist) {
        worst = i
        worstDist = d
      }
    }
    if (worst >= 0) {
      keep[worst] = true
      stack.push([from, worst], [worst, to])
    }
  }
}

/**
 * Simplify a polyline so every dropped point lies within `toleranceM` of the
 * result. `closed` treats `path` as an open ring (last→first implied): the
 * first point is kept as the seam and the search splits the ring at the point
 * farthest from it, so the closing segment is simplified like any other.
 * Tolerance 0 (or a path of fewer than three points) returns the input.
 */
export function simplify(path: Path, toleranceM: number, closed = false): Point[] {
  if (path.length < 3 || toleranceM <= 0) return [...path]
  const keep = new Array<boolean>(path.length).fill(false)
  if (closed) {
    let far = 1
    let farDist = -1
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i]![0] - path[0]![0], path[i]![1] - path[0]![1])
      if (d > farDist) {
        far = i
        farDist = d
      }
    }
    keep[0] = true
    keep[far] = true
    markKept(path, 0, far, toleranceM, keep)
    // Second half: far → last → back to the seam (path[0] appended as the end).
    const tail = [...path.slice(far), path[0]!]
    const tailKeep = new Array<boolean>(tail.length).fill(false)
    tailKeep[0] = true
    tailKeep[tail.length - 1] = true
    markKept(tail, 0, tail.length - 1, toleranceM, tailKeep)
    for (let i = 1; i < tail.length - 1; i++) if (tailKeep[i]) keep[far + i] = true
  } else {
    keep[0] = true
    keep[path.length - 1] = true
    markKept(path, 0, path.length - 1, toleranceM, keep)
  }
  return path.filter((_, i) => keep[i])
}
