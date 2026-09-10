import { describe, it, expect } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { localProjection } from '../geo'
import { centroid, pathLength } from '../geometry/path'
import type { Point } from '../geometry/types'
import { formatDistance, overlayLatLngs, readout } from './overlay'
import type { Placement } from './overlay'

const circuit = loadMetricCircuits()[0]!
const anchor = [-8.6291, 41.1579] as const

/** Project the on-map overlay back to local metres around the anchor. */
function overlayMetres(placement: Placement): Point[] {
  const proj = localProjection(placement.anchor)
  return overlayLatLngs(circuit, placement).map((c) => proj.toLocal(c))
}

describe('overlayLatLngs', () => {
  it('puts the centreline centroid at the anchor for scale 1, rotation 0', () => {
    const [cx, cy] = centroid(overlayMetres({ anchor, rotationRad: 0, scale: 1 }))
    expect(Math.hypot(cx, cy)).toBeLessThan(1) // within a metre
  })

  it('multiplies the on-map lap length by the scale factor', () => {
    const base = pathLength(overlayMetres({ anchor, rotationRad: 0, scale: 1 }), true)
    const scaled = pathLength(overlayMetres({ anchor, rotationRad: 0, scale: 2.5 }), true)
    expect(scaled / base).toBeCloseTo(2.5, 3)
    expect(base).toBeCloseTo(circuit.lengthM, 0)
  })

  it('rotates every point about the anchor by the rotation angle', () => {
    const theta = 0.7
    const plain = overlayMetres({ anchor, rotationRad: 0, scale: 1 })
    const turned = overlayMetres({ anchor, rotationRad: theta, scale: 1 })
    for (let i = 0; i < plain.length; i += 7) {
      const a = Math.atan2(plain[i]![1], plain[i]![0])
      const b = Math.atan2(turned[i]![1], turned[i]![0])
      let delta = b - a
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)) // wrap to (-π, π]
      expect(delta).toBeCloseTo(theta, 4)
    }
  })
})

describe('readout', () => {
  it('scales lap length and longest straight, ignoring anchor and rotation', () => {
    expect(readout(circuit, 1)).toEqual({
      lapM: circuit.lengthM,
      straightM: circuit.longestStraight.lengthM,
    })
    const r = readout(circuit, 1.5)
    expect(r.lapM).toBeCloseTo(circuit.lengthM * 1.5, 6)
    expect(r.straightM).toBeCloseTo(circuit.longestStraight.lengthM * 1.5, 6)
  })
})

describe('formatDistance', () => {
  it('switches from metres to km at 1 km', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(940)).toBe('940 m')
    expect(formatDistance(999.4)).toBe('999 m')
    expect(formatDistance(1000)).toBe('1.00 km')
    expect(formatDistance(1850)).toBe('1.85 km')
  })
})
