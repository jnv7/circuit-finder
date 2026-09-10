// Operations on polylines / rings, all in metric space.
import type { Path, Point } from './types'
import { distance } from './vector'

/** Iterate the segments of a path, including the closing segment when `closed`. */
function* segments(path: Path, closed: boolean): Generator<readonly [Point, Point]> {
  for (let i = 0; i < path.length - 1; i++) yield [path[i]!, path[i + 1]!]
  if (closed && path.length > 1) yield [path[path.length - 1]!, path[0]!]
}

/** Total length of a path. When `closed`, includes the last → first segment. */
export function pathLength(path: Path, closed = true): number {
  let total = 0
  for (const [a, b] of segments(path, closed)) total += distance(a, b)
  return total
}

/** Axis-aligned bounding box of the path's vertices. */
export function bounds(path: Path): { min: Point; max: Point } {
  if (path.length === 0) throw new Error('bounds: empty path')
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of path) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { min: [minX, minY], max: [maxX, maxY] }
}

/** Shoelace signed area of the closed polygon. Positive for counter-clockwise. */
export function signedArea(path: Path): number {
  if (path.length < 3) return 0
  let sum = 0
  for (const [a, b] of segments(path, true)) sum += a[0] * b[1] - b[0] * a[1]
  return sum / 2
}

/**
 * Centroid of the path. Uses the polygon area centroid; when the signed area is
 * ~0 (degenerate / collinear), falls back to the mean of the vertices.
 */
export function centroid(path: Path): Point {
  if (path.length === 0) throw new Error('centroid: empty path')
  const area = signedArea(path)
  if (Math.abs(area) < 1e-9) {
    let sx = 0
    let sy = 0
    for (const [x, y] of path) {
      sx += x
      sy += y
    }
    return [sx / path.length, sy / path.length]
  }
  let cx = 0
  let cy = 0
  for (const [a, b] of segments(path, true)) {
    const w = a[0] * b[1] - b[0] * a[1]
    cx += (a[0] + b[0]) * w
    cy += (a[1] + b[1]) * w
  }
  return [cx / (6 * area), cy / (6 * area)]
}

/** Translate the path so its centroid sits at the origin. */
export function recenter(path: Path): Point[] {
  const [cx, cy] = centroid(path)
  return path.map(([x, y]) => [x - cx, y - cy])
}

/**
 * Resample a path to points evenly spaced by arc length. `spacingM` must be
 * > 0. The first point coincides with `path[0]`. For a closed path the result
 * is a ring (no repeated closing point); for an open path the last point
 * coincides with the last input point.
 */
export function resample(path: Path, spacingM: number, closed = true): Point[] {
  if (!(spacingM > 0)) throw new Error('resample: spacingM must be > 0')
  if (path.length < 2) return path.map((p) => [p[0], p[1]])

  const total = pathLength(path, closed)
  if (total === 0) return [[path[0]![0], path[0]![1]]]

  const count = Math.max(closed ? 3 : 2, Math.round(total / spacingM))
  const step = total / (closed ? count : count - 1)

  const segs = [...segments(path, closed)]
  const out: Point[] = []
  let segIdx = 0
  let segStart = 0 // arc length at the start of segs[segIdx]
  const limit = closed ? count : count

  for (let i = 0; i < limit; i++) {
    let target = i * step
    if (i === limit - 1 && !closed) target = total // pin the open endpoint exactly
    while (segIdx < segs.length - 1 && segStart + distance(segs[segIdx]![0], segs[segIdx]![1]) < target) {
      segStart += distance(segs[segIdx]![0], segs[segIdx]![1])
      segIdx++
    }
    const [a, b] = segs[segIdx]!
    const segLen = distance(a, b)
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (target - segStart) / segLen))
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}
