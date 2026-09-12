import { describe, it, expect } from 'vitest'
import { resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import { buildStreetIndex } from '../streets'
import type { Street } from '../streets'
import { MIN_COVERAGE, sampleIndices, scoreCandidate } from './objective'
import type { SearchInput } from './types'

// A 400 × 300 rectangle centreline, centroid at the origin.
const rect: Point[] = [
  [-200, -150],
  [200, -150],
  [200, 150],
  [-200, 150],
]
const circuitSamplesM = resample(rect, 15, true)

// The same rectangle drawn as real streets, translated to (1000, 800).
const ANCHOR: Point = [1000, 800]
const streetRect: Street = [
  [800, 650],
  [1200, 650],
  [1200, 950],
  [800, 950],
  [800, 650],
]
const index = buildStreetIndex([streetRect], 50)

const input: SearchInput = {
  circuitSamplesM,
  scale: 1,
  index,
  bbox: { min: [0, 0], max: [2000, 1600] },
  ways: [streetRect],
  circuitStraight: { a: rect[0]!, b: rect[1]!, lengthM: 400 },
}

describe('scoreCandidate', () => {
  it('near-perfect fit: high coverage, ~0 turning & Procrustes, high score', () => {
    const s = scoreCandidate(input, { anchorM: ANCHOR, rotationRad: 0 }, 64)
    expect(s.coverage).toBeGreaterThan(0.95)
    expect(s.turningDistance).toBeLessThan(0.05)
    expect(s.procrustesResidual).toBeLessThan(1)
    expect(s.meanDeviationM).toBeLessThan(2)
    expect(s.score).toBeGreaterThan(0.8)
  })

  it('empty space: coverage 0 and well below the drop threshold', () => {
    const s = scoreCandidate(input, { anchorM: [200, 200], rotationRad: 0 }, 64)
    expect(s.coverage).toBe(0)
    expect(s.coverage).toBeLessThan(MIN_COVERAGE)
  })

  it('half on / half off: mid coverage and a score between the two', () => {
    const perfect = scoreCandidate(input, { anchorM: ANCHOR, rotationRad: 0 }, 64)
    const shifted = scoreCandidate(
      input,
      { anchorM: [ANCHOR[0] + 200, ANCHOR[1]], rotationRad: 0 },
      64,
    )
    expect(shifted.coverage).toBeGreaterThan(0.15)
    expect(shifted.coverage).toBeLessThan(0.85)
    expect(shifted.score).toBeLessThan(perfect.score)
  })

  it('does not credit a street the circuit only crosses (wrong heading)', () => {
    // Streets are one dense bundle of vertical lines; the circuit's top and
    // bottom edges run horizontally across them — near, but not runnable.
    const grid: Street[] = []
    for (let x = 800; x <= 1200; x += 8) grid.push([[x, 600], [x, 1000]])
    const crossIndex = buildStreetIndex(grid, 50)
    const crossInput: SearchInput = { ...input, index: crossIndex }
    const s = scoreCandidate(crossInput, { anchorM: ANCHOR, rotationRad: 0 }, 64)
    // The left/right edges run along the vertical streets, the top/bottom cross
    // them — so at most roughly half can count, and in practice less.
    expect(s.coverage).toBeLessThan(0.6)
  })

  it('is pure — same inputs, same score', () => {
    const a = scoreCandidate(input, { anchorM: ANCHOR, rotationRad: 0.2 }, 48)
    const b = scoreCandidate(input, { anchorM: ANCHOR, rotationRad: 0.2 }, 48)
    expect(a).toEqual(b)
  })
})

describe('sampleIndices', () => {
  it('returns every index when k >= n', () => {
    expect(sampleIndices(4, 4)).toEqual([0, 1, 2, 3])
    expect(sampleIndices(4, 10)).toEqual([0, 1, 2, 3])
  })

  it('otherwise returns k evenly spread indices, strictly increasing', () => {
    const idx = sampleIndices(100, 10)
    expect(idx).toHaveLength(10)
    expect(idx).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
    for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThan(idx[i - 1]!)
  })
})
