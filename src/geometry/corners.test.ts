import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { extractCorners } from './corners'
import { transformPath } from './transform'
import type { Point } from './types'
import { arbTransform } from './testing'

describe('extractCorners', () => {
  it('a square ring returns exactly its 4 corners, each turning ~π/2', () => {
    const square: Point[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    const corners = extractCorners(square)
    expect(corners).toHaveLength(4)
    expect(corners.map((c) => c.index)).toEqual([0, 1, 2, 3])
    for (const c of corners) expect(c.turnRad).toBeCloseTo(Math.PI / 2, 3)
  })

  it('excludes a joint whose turn is small resampling noise, keeping the real corners', () => {
    // A 300x300 rectangle with one extra point on the bottom edge, nudged 3m
    // off the straight line — a resampling wiggle, not a real corner.
    const path: Point[] = [
      [0, 0],
      [150, 3],
      [300, 0],
      [300, 300],
      [0, 300],
    ]
    const corners = extractCorners(path)
    expect(corners.map((c) => c.index)).toEqual([0, 2, 3, 4])
    for (const c of corners) expect(c.turnRad).toBeCloseTo(Math.PI / 2, 1)
  })

  it('merges two corners closer than minSpacingM, keeping the sharper one', () => {
    // A 300x300 square with one corner chamfered into two close, unequally
    // sharp joints (47 m apart) — a corner complex that should read as one
    // landmark, not two.
    const path: Point[] = [
      [0, 0],
      [300, 0],
      [300, 260],
      [275, 300],
      [0, 300],
    ]
    const corners = extractCorners(path, { minSpacingM: 60 })
    expect(corners.map((c) => c.index)).toEqual([0, 1, 3, 4])
    // The kept joint (index 3) is the sharper of the merged pair.
    const kept = corners.find((c) => c.index === 3)!
    expect(kept.turnRad).toBeGreaterThan(1)
    for (const idx of [0, 1, 4]) {
      expect(corners.find((c) => c.index === idx)!.turnRad).toBeCloseTo(Math.PI / 2, 2)
    }
  })

  it('a near-circular ring with no joint exceeding minTurnRad returns no corners', () => {
    const n = 60
    const r = 500
    const circleish: Point[] = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n
      return [r * Math.cos(a), r * Math.sin(a)] as Point
    })
    expect(extractCorners(circleish)).toEqual([])
  })

  it('is invariant to a similarity transform when minSpacingM scales with it', () => {
    // A "gear" polygon alternating far/near radii so every vertex is a sharp,
    // well-separated corner in the base shape — corner detection (turn angle)
    // is scale/rotation/translation-invariant on its own, but the *merge*
    // distance is metric, so minSpacingM must scale with the transform's
    // scale for the corner *count* to stay invariant too.
    const arbGear = fc.integer({ min: 3, max: 8 }).map((k): Point[] => {
      const outerR = 300
      const innerR = 75
      const pts: Point[] = []
      for (let i = 0; i < 2 * k; i++) {
        const a = (Math.PI * i) / k
        const r = i % 2 === 0 ? outerR : innerR
        pts.push([r * Math.cos(a), r * Math.sin(a)])
      }
      return pts
    })

    fc.assert(
      fc.property(arbGear, arbTransform(), (path, t) => {
        const base = extractCorners(path, { minSpacingM: 60 })
        const transformed = transformPath(t, path)
        const after = extractCorners(transformed, { minSpacingM: 60 * t.scale })
        expect(after.length).toBe(base.length)
      }),
    )
  })
})
