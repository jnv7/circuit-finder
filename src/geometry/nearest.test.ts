import { describe, it, expect } from 'vitest'
import { closestPointOnSegment, distanceToSegment } from './nearest'
import type { Point } from './types'

describe('closestPointOnSegment', () => {
  const a: Point = [0, 0]
  const b: Point = [10, 0]

  it('drops a perpendicular onto the interior of the segment', () => {
    expect(closestPointOnSegment([3, 4], a, b)).toEqual([3, 0])
  })

  it('clamps past the start', () => {
    expect(closestPointOnSegment([-5, 2], a, b)).toEqual([0, 0])
  })

  it('clamps past the end', () => {
    expect(closestPointOnSegment([20, -3], a, b)).toEqual([10, 0])
  })

  it('returns a for a degenerate segment', () => {
    expect(closestPointOnSegment([5, 5], [2, 2], [2, 2])).toEqual([2, 2])
  })
})

describe('distanceToSegment', () => {
  const a: Point = [0, 0]
  const b: Point = [10, 0]

  it('is the perpendicular distance for an interior foot', () => {
    expect(distanceToSegment([3, 4], a, b)).toBeCloseTo(4)
  })

  it('is the endpoint distance past an end', () => {
    expect(distanceToSegment([13, 4], a, b)).toBeCloseTo(5)
  })

  it('is the point-to-a distance for a degenerate segment', () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBeCloseTo(5)
  })

  it('is symmetric in a and b', () => {
    const p: Point = [7, 9]
    expect(distanceToSegment(p, a, b)).toBeCloseTo(distanceToSegment(p, b, a))
  })
})
