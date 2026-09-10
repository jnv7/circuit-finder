import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { Point } from './types'
import { cumulativeTurning, turningDistance } from './turning'

const square: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]

describe('cumulativeTurning', () => {
  it('a unit square turns by π/2 at each corner, 2π in total (closed)', () => {
    const t = cumulativeTurning(square, true)
    expect(t).toHaveLength(square.length)
    expect(t[0]).toBe(0)
    expect(t[1]).toBeCloseTo(Math.PI / 2)
    expect(t[2]).toBeCloseTo(Math.PI)
    expect(t[3]).toBeCloseTo((3 * Math.PI) / 2)
  })

  it('has length path.length - 1 when open', () => {
    expect(cumulativeTurning(square, false)).toHaveLength(square.length - 1)
  })

  it('is all zeros for a straight open path', () => {
    const line: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]
    expect(cumulativeTurning(line, false).every((v) => Math.abs(v) < 1e-12)).toBe(true)
  })
})

describe('turningDistance', () => {
  it('is zero against itself', () => {
    const t = cumulativeTurning(square, true)
    expect(turningDistance(t, t)).toBeCloseTo(0)
  })

  it('ignores a constant offset added to every element', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { minLength: 3, maxLength: 30 }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (a, k) => {
          const shifted = a.map((v) => v + k)
          expect(turningDistance(a, shifted)).toBeCloseTo(0)
        },
      ),
    )
  })

  it('grows well above zero for a genuinely different shape', () => {
    const skewed: Point[] = [
      [0, 0],
      [10, 0],
      [12, 9],
      [-3, 6],
    ]
    const a = cumulativeTurning(square, true)
    const b = cumulativeTurning(skewed, true)
    expect(turningDistance(a, a)).toBeCloseTo(0)
    expect(turningDistance(a, b)).toBeGreaterThan(0.2)
  })

  it('throws on a length mismatch', () => {
    expect(() => turningDistance([0, 1], [0])).toThrow()
  })
})
