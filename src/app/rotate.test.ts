import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { bearingFromDrag, handlePixel } from './rotate'

describe('bearingFromDrag', () => {
  const center = [100, 100] as const

  it('is 0 when the pointer is straight above the centre', () => {
    expect(bearingFromDrag(center, [100, 20])).toBeCloseTo(0, 12)
  })

  it('is +π/2 when the pointer is to the left (counter-clockwise on screen)', () => {
    expect(bearingFromDrag(center, [20, 100])).toBeCloseTo(Math.PI / 2, 12)
  })

  it('is -π/2 when the pointer is to the right', () => {
    expect(bearingFromDrag(center, [180, 100])).toBeCloseTo(-Math.PI / 2, 12)
  })
})

describe('handlePixel / bearingFromDrag round-trip', () => {
  it('recovers the angle it was drawn at', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI + 1e-6, max: Math.PI, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: 5, max: 300, noNaN: true }),
        (theta, cx, cy, radius) => {
          const center = [cx, cy] as const
          const recovered = bearingFromDrag(center, handlePixel(center, theta, radius))
          const delta = Math.atan2(Math.sin(recovered - theta), Math.cos(recovered - theta))
          expect(Math.abs(delta)).toBeLessThan(1e-9)
        },
      ),
    )
  })
})
