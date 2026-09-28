import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { simplify } from './simplify'
import { arbPolygon } from './testing'
import type { Path, Point } from './types'

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Distance from `p` to the nearest segment of `result` (closed adds the seam). */
function distToPath(p: Point, result: Path, closed: boolean): number {
  let best = Infinity
  const n = result.length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    best = Math.min(best, distToSegment(p, result[i]!, result[(i + 1) % n]!))
  }
  return best
}

describe('simplify (open)', () => {
  it('drops collinear points but keeps both endpoints', () => {
    const line: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0], [10, 0]]
    expect(simplify(line, 0.5)).toEqual([[0, 0], [10, 0]])
  })

  it('keeps a spike beyond the tolerance and drops a wiggle inside it', () => {
    const spike: Point[] = [[0, 0], [5, 4], [10, 0]]
    expect(simplify(spike, 2)).toEqual(spike)
    const wiggle: Point[] = [[0, 0], [5, 1], [10, 0]]
    expect(simplify(wiggle, 2)).toEqual([[0, 0], [10, 0]])
  })

  it('measures against the segment, not the infinite line', () => {
    // (20, 1) is 1 m from the infinite line through the ends, but 10+ m from
    // the segment they span, so it must be kept at tolerance 2.
    const path: Point[] = [[0, 0], [20, 1], [10, 0.001]]
    expect(simplify(path, 2)).toHaveLength(3)
  })

  it('tolerance 0 is the identity, and short paths are returned unchanged', () => {
    const path: Point[] = [[0, 0], [1, 0], [2, 0], [3, 1]]
    expect(simplify(path, 0)).toEqual(path)
    expect(simplify([[0, 0], [5, 5]], 10)).toEqual([[0, 0], [5, 5]])
  })

  it('every original point lies within tolerance of the result (property)', () => {
    fc.assert(
      fc.property(arbPolygon(5, 60), fc.double({ min: 0.5, max: 40, noNaN: true }), (poly, tol) => {
        const result = simplify(poly, tol, false)
        expect(result[0]).toEqual(poly[0])
        expect(result[result.length - 1]).toEqual(poly[poly.length - 1])
        for (const p of poly) expect(distToPath(p, result, false)).toBeLessThanOrEqual(tol + 1e-9)
      }),
    )
  })
})

describe('simplify (closed ring)', () => {
  it('drops the mid-edge points of a square but keeps the corners and the seam', () => {
    const ring: Point[] = [
      [0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5],
    ]
    expect(simplify(ring, 0.5, true)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })

  it('simplifies the closing segment too, not only the listed ones', () => {
    // A point sitting on the implied last→first edge must be dropped.
    const ring: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 5]]
    expect(simplify(ring, 0.5, true)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })

  it('keeps the seam point and stays a valid ring (property)', () => {
    fc.assert(
      fc.property(arbPolygon(5, 60), fc.double({ min: 0.5, max: 40, noNaN: true }), (poly, tol) => {
        const result = simplify(poly, tol, true)
        expect(result[0]).toEqual(poly[0])
        expect(result.length).toBeGreaterThanOrEqual(2)
        for (const p of poly) expect(distToPath(p, result, true)).toBeLessThanOrEqual(tol + 1e-9)
      }),
    )
  })
})
