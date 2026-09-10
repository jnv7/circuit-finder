import { describe, it, expect } from 'vitest'
import {
  add,
  angleBetween,
  cross,
  distance,
  dot,
  length,
  normalize,
  rotate,
  scale,
  subtract,
} from './vector'

describe('vector', () => {
  it('add / subtract / scale', () => {
    expect(add([1, 2], [3, 4])).toEqual([4, 6])
    expect(subtract([3, 4], [1, 2])).toEqual([2, 2])
    expect(scale([2, -3], 2)).toEqual([4, -6])
  })

  it('length and distance', () => {
    expect(length([3, 4])).toBe(5)
    expect(distance([1, 1], [4, 5])).toBe(5)
  })

  it('dot and cross', () => {
    expect(dot([1, 0], [0, 1])).toBe(0)
    expect(dot([2, 3], [4, 5])).toBe(23)
    expect(cross([1, 0], [0, 1])).toBe(1)
  })

  it('rotate by 90 degrees maps +x to +y', () => {
    const [x, y] = rotate([1, 0], Math.PI / 2)
    expect(x).toBeCloseTo(0, 12)
    expect(y).toBeCloseTo(1, 12)
  })

  it('rotate preserves length', () => {
    expect(length(rotate([3, 4], 0.9))).toBeCloseTo(5, 12)
  })

  it('normalize returns a unit vector, or zero for the zero vector', () => {
    expect(length(normalize([10, 0]))).toBeCloseTo(1, 12)
    expect(normalize([0, 0])).toEqual([0, 0])
  })

  it('angleBetween is signed and in (-pi, pi]', () => {
    expect(angleBetween([1, 0], [0, 1])).toBeCloseTo(Math.PI / 2, 12)
    expect(angleBetween([1, 0], [0, -1])).toBeCloseTo(-Math.PI / 2, 12)
    expect(angleBetween([1, 0], [1, 0])).toBeCloseTo(0, 12)
  })
})
