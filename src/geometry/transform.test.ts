import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { apply, compose, IDENTITY, invert, transformPath } from './transform'
import { signedArea } from './path'
import { distance } from './vector'
import type { Point } from './types'
import { arbPolygon, arbTransform } from './testing'

const p: Point = [3, 5]

describe('transform', () => {
  it('identity is a no-op', () => {
    expect(apply(IDENTITY, p)).toEqual(p)
  })

  it('applies scale, then rotation, then translation', () => {
    const t = { translate: [1, 2] as Point, rotation: Math.PI / 2, scale: 2 }
    const [x, y] = apply(t, [1, 0])
    expect(x).toBeCloseTo(1, 12) // 2*[1,0] -> rot90 -> [0,2] -> +[1,2] = [1,4]
    expect(y).toBeCloseTo(4, 12)
  })

  it('compose(a, b) equals applying b then a (property)', () => {
    fc.assert(
      fc.property(arbTransform(), arbTransform(), arbPolygon(), (a, b, poly) => {
        const viaCompose = transformPath(compose(a, b), poly)
        const viaSequence = poly.map((pt) => apply(a, apply(b, pt)))
        for (let i = 0; i < poly.length; i++) {
          expect(distance(viaCompose[i]!, viaSequence[i]!)).toBeLessThan(1e-6)
        }
      }),
    )
  })

  it('invert undoes the transform (property)', () => {
    fc.assert(
      fc.property(arbTransform(), arbPolygon(), (t, poly) => {
        const round = transformPath(invert(t), transformPath(t, poly))
        for (let i = 0; i < poly.length; i++) {
          expect(distance(round[i]!, poly[i]!)).toBeLessThan(1e-6 * (1 + distance(poly[i]!, [0, 0])))
        }
      }),
    )
  })

  it('preserves orientation and scales area by scale^2 (property, no reflection)', () => {
    fc.assert(
      fc.property(arbTransform(), arbPolygon(), (t, poly) => {
        const before = signedArea(poly)
        const after = signedArea(transformPath(t, poly))
        const expected = before * t.scale * t.scale
        expect(Math.sign(after)).toBe(Math.sign(before))
        expect(Math.abs(after - expected)).toBeLessThan(Math.abs(expected) * 1e-6 + 1e-6)
      }),
    )
  })
})
