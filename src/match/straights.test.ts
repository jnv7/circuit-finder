import { describe, expect, it } from 'vitest'
import { rotate } from '../geometry/vector'
import type { Point } from '../geometry/types'
import type { Street } from '../streets'
import { findMatchingStreetStraights, seedFromStraight } from './straights'
import type { StreetStraight } from './straights'

/** A single straight-line street of the given length, starting at the origin. */
function straightWay(lengthM: number): Street {
  return [
    [0, 0],
    [lengthM, 0],
  ]
}

describe('findMatchingStreetStraights', () => {
  it('keeps only streets whose own longest straight falls in [0.6, 1.6] of the target length', () => {
    const target = 100
    const tooShort = straightWay(50) // 0.5x — below the band
    const inBand = straightWay(120) // 1.2x — inside the band
    const tooLong = straightWay(200) // 2x — above the band
    // A right-angle zigzag: every joint turns ~90°, far past the default
    // straight-detection tolerance, so its longest straight is just one 10 m
    // segment — well below the band regardless of the zigzag's total extent.
    const zigzag: Street = [
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
      [20, 20],
      [30, 20],
    ]

    const matches = findMatchingStreetStraights([tooShort, inBand, tooLong, zigzag], target)

    expect(matches).toHaveLength(1)
    expect(matches[0]!.lengthM).toBeCloseTo(120, 6)
  })

  it('returns [] for an empty ways list', () => {
    expect(findMatchingStreetStraights([], 100)).toEqual([])
  })

  it('is inclusive at the band edges', () => {
    const target = 100
    const atMin = straightWay(60)
    const atMax = straightWay(160)
    const matches = findMatchingStreetStraights([atMin, atMax], target)
    expect(matches).toHaveLength(2)
  })
})

describe('seedFromStraight', () => {
  // Circuit straight in the local frame: bearing 0 (pointing +x), midpoint
  // [200, 50], length 200 — deliberately not centred at the origin, so a bug
  // that ignores the translate step would still be caught.
  const circuitStraight = { a: [100, 50] as Point, b: [300, 50] as Point }
  // A vertical street straight (bearing π/2) elsewhere in the metric frame.
  const streetStraight: StreetStraight = {
    a: [1000, 500],
    b: [1000, 700],
    lengthM: 200,
    bearing: Math.PI / 2,
  }

  it('the first candidate places the circuit straight bearing-for-bearing onto the street straight', () => {
    const [forward] = seedFromStraight(circuitStraight, streetStraight)
    expect(forward.rotationRad).toBeCloseTo(streetStraight.bearing, 9)

    const circuitMid: Point = [200, 50]
    const placedMid = rotate(circuitMid, forward.rotationRad)
    const anchored: Point = [placedMid[0] + forward.anchorM[0], placedMid[1] + forward.anchorM[1]]
    const streetMid: Point = [1000, 600]
    expect(anchored[0]).toBeCloseTo(streetMid[0], 6)
    expect(anchored[1]).toBeCloseTo(streetMid[1], 6)
  })

  it('the second candidate runs the reverse direction along the same street straight', () => {
    const [, reverse] = seedFromStraight(circuitStraight, streetStraight)
    expect(reverse.rotationRad).toBeCloseTo(streetStraight.bearing + Math.PI, 9)

    const circuitMid: Point = [200, 50]
    const placedMid = rotate(circuitMid, reverse.rotationRad)
    const anchored: Point = [placedMid[0] + reverse.anchorM[0], placedMid[1] + reverse.anchorM[1]]
    const streetMid: Point = [1000, 600]
    expect(anchored[0]).toBeCloseTo(streetMid[0], 6)
    expect(anchored[1]).toBeCloseTo(streetMid[1], 6)
  })
})
