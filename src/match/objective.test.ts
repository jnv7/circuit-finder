import { describe, it, expect } from 'vitest'
import { resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import { buildStreetIndex } from '../streets'
import type { Street } from '../streets'
import { MIN_COVERAGE, scoreCandidate } from './objective'
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

  it('is pure — same inputs, same score', () => {
    const a = scoreCandidate(input, { anchorM: ANCHOR, rotationRad: 0.2 }, 48)
    const b = scoreCandidate(input, { anchorM: ANCHOR, rotationRad: 0.2 }, 48)
    expect(a).toEqual(b)
  })
})
