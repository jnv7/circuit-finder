import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { longestStraight } from './straight'
import { transformPath } from './transform'
import type { Point } from './types'
import { arbRotationOnly, arbTransform } from './testing'

/**
 * A rectangle `width` x `height` (width is the long axis, along +x), corners
 * rounded with quarter-circle arcs of radius `r`. Returned CCW as an open ring.
 * Each long side has a straight run of exactly `width - 2 * r`.
 */
function roundedRect(width: number, height: number, r: number): Point[] {
  const hw = width / 2
  const hh = height / 2
  // straight part of each side, endpoints included
  const edge = (from: Point, to: Point): Point[] => {
    const n = 10
    return Array.from({ length: n + 1 }, (_, i): Point => {
      const t = i / n
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
    })
  }
  // quarter arc, interior points only (endpoints belong to the adjacent edges)
  const arc = (cx: number, cy: number, a0: number, a1: number): Point[] => {
    const steps = 4
    return Array.from({ length: steps - 1 }, (_, i): Point => {
      const a = a0 + ((a1 - a0) * (i + 1)) / steps
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
  }
  return [
    ...edge([-hw + r, -hh], [hw - r, -hh]), // bottom, heading +x
    ...arc(hw - r, -hh + r, -Math.PI / 2, 0),
    ...edge([hw, -hh + r], [hw, hh - r]), // right, heading +y
    ...arc(hw - r, hh - r, 0, Math.PI / 2),
    ...edge([hw - r, hh], [-hw + r, hh]), // top, heading -x
    ...arc(-hw + r, hh - r, Math.PI / 2, Math.PI),
    ...edge([-hw, hh - r], [-hw, -hh + r]), // left, heading -y
    ...arc(-hw + r, -hh + r, Math.PI, (3 * Math.PI) / 2),
  ]
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

describe('longestStraight', () => {
  it('rejects a path with fewer than 2 points', () => {
    expect(() => longestStraight([[0, 0]])).toThrow()
  })

  it('finds the long side of a rounded rectangle', () => {
    const ring = roundedRect(300, 120, 15)
    const s = longestStraight(ring)
    expect(s.lengthM).toBeCloseTo(300 - 2 * 15, 6)
    // first long edge is sampled heading +x
    expect(Math.abs(angleDiff(s.bearing, 0))).toBeLessThan(1e-9)
  })

  it('returns the whole loop when nothing turns hard (circle-ish, no break)', () => {
    const n = 64
    const ring: Point[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI
      ring.push([100 * Math.cos(a), 100 * Math.sin(a)])
    }
    const s = longestStraight(ring, { maxTurnRad: 0.2 })
    expect(s.lengthM).toBeCloseTo(2 * n * 100 * Math.sin(Math.PI / n), 6)
  })

  it('length scales with the transform scale (property)', () => {
    fc.assert(
      fc.property(arbTransform(), (t) => {
        const ring = roundedRect(300, 120, 15)
        const base = longestStraight(ring).lengthM
        const scaled = longestStraight(transformPath(t, ring)).lengthM
        expect(scaled).toBeCloseTo(base * t.scale, 3)
      }),
    )
  })

  it('bearing rotates by the transform rotation; index range is stable (property)', () => {
    fc.assert(
      fc.property(arbRotationOnly(), (t) => {
        const ring = roundedRect(280, 150, 20)
        const base = longestStraight(ring)
        const moved = longestStraight(transformPath(t, ring))
        expect(moved.startIndex).toBe(base.startIndex)
        expect(moved.endIndex).toBe(base.endIndex)
        expect(Math.abs(angleDiff(moved.bearing, base.bearing + t.rotation))).toBeLessThan(1e-6)
      }),
    )
  })
})
