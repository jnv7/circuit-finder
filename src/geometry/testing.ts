// Test-only helpers for generating shapes with fast-check.
import fc from 'fast-check'
import type { Point, SimilarityTransform } from './types'

/**
 * A simple (non-self-intersecting) closed polygon: random radii sampled at
 * strictly increasing angles around a centre, returned as an open ring.
 */
export const arbPolygon = (min = 5, max = 40): fc.Arbitrary<Point[]> =>
  fc
    .integer({ min, max })
    .chain((n) =>
      fc.tuple(
        fc.array(fc.double({ min: 0.05, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
        fc.array(fc.double({ min: 20, max: 400, noNaN: true }), { minLength: n, maxLength: n }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
      ),
    )
    .map(([fractions, radii, cx, cy]) => {
      const gaps = fractions.map((f) => f + 0.05)
      const totalGap = gaps.reduce((s, g) => s + g, 0)
      let angle = 0
      return gaps.map((g, i) => {
        angle += (g / totalGap) * Math.PI * 2
        const r = radii[i]!
        return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as Point
      })
    })

export const arbTransform = (): fc.Arbitrary<SimilarityTransform> =>
  fc
    .record({
      tx: fc.double({ min: -1000, max: 1000, noNaN: true }),
      ty: fc.double({ min: -1000, max: 1000, noNaN: true }),
      rotation: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      scale: fc.double({ min: 0.1, max: 10, noNaN: true }),
    })
    .map(({ tx, ty, rotation, scale }) => ({ translate: [tx, ty], rotation, scale }))

export const arbRotationOnly = (): fc.Arbitrary<SimilarityTransform> =>
  fc
    .record({
      tx: fc.double({ min: -1000, max: 1000, noNaN: true }),
      ty: fc.double({ min: -1000, max: 1000, noNaN: true }),
      rotation: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    })
    .map(({ tx, ty, rotation }) => ({ translate: [tx, ty], rotation, scale: 1 }))
