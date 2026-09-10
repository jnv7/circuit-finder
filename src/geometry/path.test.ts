import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { bounds, centroid, pathLength, recenter, resample, signedArea } from './path'
import { transformPath } from './transform'
import { distance } from './vector'
import type { Point } from './types'
import { arbPolygon, arbRotationOnly, arbTransform } from './testing'

const square: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]

describe('pathLength', () => {
  it('measures an open polyline and a closed ring', () => {
    expect(pathLength(square, false)).toBe(30)
    expect(pathLength(square, true)).toBe(40)
  })

  it('is invariant under rotation and translation (property)', () => {
    fc.assert(
      fc.property(arbPolygon(), arbRotationOnly(), (poly, t) => {
        const before = pathLength(poly, true)
        const after = pathLength(transformPath(t, poly), true)
        expect(after).toBeCloseTo(before, 4)
      }),
    )
  })

  it('scales by exactly the transform scale (property)', () => {
    fc.assert(
      fc.property(arbPolygon(), arbTransform(), (poly, t) => {
        const before = pathLength(poly, true)
        const after = pathLength(transformPath(t, poly), true)
        expect(after).toBeCloseTo(before * t.scale, 3)
      }),
    )
  })
})

describe('signedArea', () => {
  it('is positive for a counter-clockwise ring, negative reversed', () => {
    expect(signedArea(square)).toBe(100)
    expect(signedArea([...square].reverse())).toBe(-100)
  })
})

describe('centroid / recenter', () => {
  it('finds the centre of a square', () => {
    expect(centroid(square)).toEqual([5, 5])
  })

  it('recenter puts the centroid at the origin (property)', () => {
    fc.assert(
      fc.property(arbPolygon(), (poly) => {
        const [cx, cy] = centroid(recenter(poly))
        expect(cx).toBeCloseTo(0, 6)
        expect(cy).toBeCloseTo(0, 6)
      }),
    )
  })
})

describe('bounds', () => {
  it('returns the axis-aligned box', () => {
    expect(bounds(square)).toEqual({ min: [0, 0], max: [10, 10] })
  })
})

describe('resample', () => {
  it('rejects a non-positive spacing', () => {
    expect(() => resample(square, 0)).toThrow()
  })

  it('produces evenly spaced points close to the original length (property)', () => {
    fc.assert(
      fc.property(arbPolygon(8, 30), fc.double({ min: 5, max: 40, noNaN: true }), (poly, spacing) => {
        const before = pathLength(poly, true)
        const pts = resample(poly, spacing, true)

        const expectedCount = Math.max(3, Math.round(before / spacing))
        expect(pts.length).toBe(expectedCount)

        const arcStep = before / expectedCount
        for (let i = 0; i < pts.length; i++) {
          // straight-line gap can only be shorter than the arc step it samples.
          expect(distance(pts[i]!, pts[(i + 1) % pts.length]!)).toBeLessThanOrEqual(arcStep + 1e-6)
        }

        const after = pathLength(pts, true)
        expect(after).toBeLessThanOrEqual(before + 1e-6)
        expect(after).toBeGreaterThan(before * 0.5)
      }),
    )
  })

  it('first resampled point coincides with the first input point', () => {
    const pts = resample(square, 3, true)
    expect(pts[0]![0]).toBeCloseTo(0, 9)
    expect(pts[0]![1]).toBeCloseTo(0, 9)
  })

  it('is near-idempotent at the same spacing (property)', () => {
    fc.assert(
      fc.property(arbPolygon(10, 24), (poly) => {
        const once = resample(poly, 12, true)
        const twice = resample(once, 12, true)
        expect(Math.abs(pathLength(once, true) - pathLength(twice, true))).toBeLessThan(
          pathLength(once, true) * 0.05 + 1,
        )
      }),
    )
  })
})
