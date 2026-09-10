import { describe, it, expect } from 'vitest'
import type { Point } from '../geometry/types'
import { buildStreetIndex } from '../streets'
import { LEVELS, lapProximity, proximityColor, quantize } from './proximity'

const GREEN = '#2e7d32'
const AMBER = '#f9a825'
const RED = '#c62828'

// A single straight street along the x-axis.
const streetIndex = buildStreetIndex([[[-100, 0], [1000, 0]]])

function translate(ring: readonly Point[], dx: number, dy: number): Point[] {
  return ring.map(([x, y]) => [x + dx, y + dy])
}

describe('lapProximity', () => {
  const onStreet: Point[] = [
    [0, 0],
    [400, 0],
    [400, 2],
    [0, 2],
  ]

  it('is fully covered and green when the ring lies on a street', () => {
    const { segments, nearFraction } = lapProximity(onStreet, streetIndex)
    for (const s of segments) {
      expect(s.coverage).toBeCloseTo(1)
      expect(s.color).toBe(GREEN)
    }
    expect(nearFraction).toBeCloseTo(1)
  })

  it('is uncovered and red when the ring is 500 m out in open space', () => {
    const { segments, nearFraction } = lapProximity(translate(onStreet, 0, 500), streetIndex)
    for (const s of segments) {
      expect(s.coverage).toBeCloseTo(0)
      expect(s.color).toBe(RED)
    }
    expect(nearFraction).toBeCloseTo(0)
  })

  it('colours on-street segments green and off-street segments red, ~half covered', () => {
    const halfOff: Point[] = [
      [0, 0],
      [400, 0],
      [400, 20],
      [0, 20],
    ]
    const { segments, nearFraction } = lapProximity(halfOff, streetIndex)
    expect(segments[0]!.coverage).toBeCloseTo(1)
    expect(segments[0]!.color).toBe(GREEN)
    expect(segments[2]!.coverage).toBeCloseTo(0)
    expect(segments[2]!.color).toBe(RED)
    expect(nearFraction).toBeCloseTo(0.5, 1)
  })
})

describe('proximityColor', () => {
  it('hits the three ramp stops', () => {
    expect(proximityColor(1)).toBe(GREEN)
    expect(proximityColor(0.5)).toBe(AMBER)
    expect(proximityColor(0)).toBe(RED)
  })

  it('interpolates componentwise between two stops', () => {
    // 0.75 is halfway between amber (0.5) and green (1.0).
    const mid = proximityColor(0.75)
    const r = parseInt(mid.slice(1, 3), 16)
    const g = parseInt(mid.slice(3, 5), 16)
    const b = parseInt(mid.slice(5, 7), 16)
    expect(r).toBe(Math.round((0xf9 + 0x2e) / 2))
    expect(g).toBe(Math.round((0xa8 + 0x7d) / 2))
    expect(b).toBe(Math.round((0x25 + 0x32) / 2))
  })

  it('always returns a #rrggbb string', () => {
    for (const c of [-1, 0, 0.13, 0.5, 0.87, 1, 2]) {
      expect(proximityColor(c)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('quantize', () => {
  it('maps [0,1] onto 0…LEVELS-1 monotonically', () => {
    let prev = -1
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const q = quantize(c)
      expect(q).toBeGreaterThanOrEqual(0)
      expect(q).toBeLessThan(LEVELS)
      expect(q).toBeGreaterThanOrEqual(prev)
      prev = q
    }
    expect(quantize(0)).toBe(0)
    expect(quantize(1)).toBe(LEVELS - 1)
  })
})
