import { describe, it, expect } from 'vitest'
import type { Point } from '../geometry/types'
import { buildStreetIndex } from '../streets'
import { LEVELS, lapDeviation, lapProximity, proximityColor, quantize } from './proximity'

const GREEN = '#2e7d32'
const AMBER = '#f9a825'
const RED = '#c62828'

// A single straight street along the x-axis.
const streetIndex = buildStreetIndex([[[-100, 0], [1000, 0]]])

function translate(ring: readonly Point[], dx: number, dy: number): Point[] {
  return ring.map(([x, y]) => [x + dx, y + dy])
}

describe('lapProximity', () => {
  // A thin loop hugging the street: both long edges run along it (±0/180°).
  const onStreet: Point[] = [
    [0, 0],
    [400, 0],
    [400, 1],
    [0, 1],
  ]

  it('is fully covered and green on the stretches that run along the street', () => {
    const { segments, nearFraction } = lapProximity(onStreet, streetIndex)
    expect(segments[0]!.coverage).toBeCloseTo(1)
    expect(segments[0]!.color).toBe(GREEN)
    expect(segments[2]!.coverage).toBeCloseTo(1)
    // The 1 m end connectors run across the street, but carry ~no length weight.
    expect(nearFraction).toBeGreaterThan(0.99)
  })

  it('is uncovered and red when the ring is 500 m out in open space', () => {
    const { segments, nearFraction } = lapProximity(translate(onStreet, 0, 500), streetIndex)
    for (const s of segments) {
      expect(s.coverage).toBeCloseTo(0)
      expect(s.color).toBe(RED)
    }
    expect(nearFraction).toBeCloseTo(0)
  })

  it('ignores a street that is close but runs the wrong way', () => {
    // A segment running north, right on top of the east-west street.
    const across: Point[] = [
      [0, -80],
      [0, -40],
      [0, 40],
      [0, 80],
    ]
    const { nearFraction } = lapProximity(across, streetIndex)
    expect(nearFraction).toBeLessThan(0.15)
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

  it('alignMaxRad = π disables the direction check', () => {
    const across: Point[] = [
      [0, -80],
      [0, -40],
      [0, 40],
      [0, 80],
    ]
    const strict = lapProximity(across, streetIndex).nearFraction
    const loose = lapProximity(across, streetIndex, { alignMaxRad: Math.PI }).nearFraction
    expect(loose).toBeGreaterThan(strict)
  })
})

describe('lapDeviation', () => {
  const onStreet: Point[] = [
    [0, 0],
    [400, 0],
    [400, 1],
    [0, 1],
  ]

  it('is small when the lap mostly runs along the street', () => {
    // Only the two 1 m end connectors cross the street; everything else is on it.
    const { meanM } = lapDeviation(onStreet, streetIndex)
    expect(meanM).toBeLessThan(2)
  })

  it('caps far-off samples at capM', () => {
    const { meanM, maxM } = lapDeviation(translate(onStreet, 0, 500), streetIndex, { capM: 30 })
    expect(meanM).toBe(30)
    expect(maxM).toBe(30)
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
