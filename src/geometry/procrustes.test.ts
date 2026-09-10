import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { Point } from './types'
import { apply, transformPath } from './transform'
import { arbPolygon, arbTransform } from './testing'
import { fitSimilarity, procrustesResidual } from './procrustes'

const shape: Point[] = [
  [0, 0],
  [20, 0],
  [20, 10],
  [10, 18],
  [0, 10],
]

describe('procrustesResidual', () => {
  it('is ~0 against itself', () => {
    expect(procrustesResidual(shape, shape)).toBeCloseTo(0)
  })

  it('is ~0 for a rotated + scaled + translated copy, and fitSimilarity recovers it', () => {
    const t = { translate: [130, -40] as Point, rotation: 0.7, scale: 1.8 }
    const moved = transformPath(t, shape)
    expect(procrustesResidual(shape, moved)).toBeCloseTo(0, 4)

    const fit = fitSimilarity(shape, moved)
    expect(fit.scale).toBeCloseTo(1.8, 4)
    expect(fit.rotation).toBeCloseTo(0.7, 4)
    expect(fit.translate[0]).toBeCloseTo(130, 3)
    expect(fit.translate[1]).toBeCloseTo(-40, 3)
  })

  it('is clearly > 0 for a reflected copy (no reflection allowed)', () => {
    const reflected = shape.map(([x, y]) => [x, -y] as Point)
    expect(procrustesResidual(shape, reflected)).toBeGreaterThan(1)
  })

  it('is > 0 for a sheared copy', () => {
    const sheared = shape.map(([x, y]) => [x + 0.5 * y, y] as Point)
    expect(procrustesResidual(shape, sheared)).toBeGreaterThan(0.5)
  })

  it('scales by |scale| when a similarity is applied to the target', () => {
    fc.assert(
      fc.property(arbPolygon(4, 12), arbTransform(), (poly, t2) => {
        // A genuinely non-similar target, so the residual is non-trivial.
        const to = poly.map(([x, y]) => [x + 0.3 * y, y * 0.8] as Point)
        const r1 = procrustesResidual(poly, to)
        const r2 = procrustesResidual(poly, transformPath(t2, to))
        const expected = r1 * t2.scale
        expect(Math.abs(r2 - expected)).toBeLessThan(1e-6 * (1 + expected))
      }),
      { numRuns: 200 },
    )
  })

  it('throws on mismatched lengths', () => {
    expect(() => fitSimilarity(shape, shape.slice(1))).toThrow()
  })

  it('apply of the fit lands near the target', () => {
    const t = { translate: [5, 5] as Point, rotation: -0.4, scale: 0.6 }
    const moved = transformPath(t, shape)
    const fit = fitSimilarity(shape, moved)
    for (let i = 0; i < shape.length; i++) {
      const p = apply(fit, shape[i]!)
      expect(p[0]).toBeCloseTo(moved[i]![0], 4)
      expect(p[1]).toBeCloseTo(moved[i]![1], 4)
    }
  })
})
