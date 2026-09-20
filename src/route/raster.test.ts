import { describe, it, expect } from 'vitest'
import { buildOrientationLayers, ORIENTATION_LAYERS } from './raster'
import type { Street } from '../streets'

describe('buildOrientationLayers — single horizontal street', () => {
  const horizontal: Street = [
    [-200, 0],
    [200, 0],
  ]
  const layers = buildOrientationLayers([horizontal], { cellM: 2 })

  it('reads ~0 on the street itself, in the layer matching its own heading', () => {
    expect(layers.distanceAt(0, [0, 0])).toBeCloseTo(0, 0)
  })

  it('grows with distance from the street, in the aligned layer', () => {
    const near = layers.distanceAt(0, [0, 4])
    const far = layers.distanceAt(0, [0, 40])
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near)
    expect(far).toBeCloseTo(40, 0)
  })

  it('a perpendicular layer (90° away) has no source anywhere and reads Infinity', () => {
    const perpLayer = ORIENTATION_LAYERS / 2
    expect(layers.layerHeadingRad(perpLayer)).toBeCloseTo(Math.PI / 2, 6)
    expect(layers.distanceAt(perpLayer, [0, 0])).toBe(Infinity)
    expect(layers.distanceAt(perpLayer, [50, 50])).toBe(Infinity)
  })

  it('out-of-bounds lookups read as no street (Infinity)', () => {
    expect(layers.distanceAt(0, [1_000_000, 1_000_000])).toBe(Infinity)
    expect(layers.distanceAt(0, [-1_000_000, -1_000_000])).toBe(Infinity)
  })
})

describe('buildOrientationLayers — single vertical street', () => {
  const vertical: Street = [
    [0, -200],
    [0, 200],
  ]
  const layers = buildOrientationLayers([vertical], { cellM: 2 })

  it('reads ~0 on the street, in the layer matching its 90° heading', () => {
    const vertLayer = ORIENTATION_LAYERS / 2
    expect(layers.distanceAt(vertLayer, [0, 0])).toBeCloseTo(0, 0)
  })

  it('the horizontal-heading layer has no source anywhere and reads Infinity', () => {
    expect(layers.distanceAt(0, [0, 0])).toBe(Infinity)
  })
})

describe('buildOrientationLayers — two crossing streets', () => {
  const horizontal: Street = [
    [-200, 0],
    [200, 0],
  ]
  const vertical: Street = [
    [0, -200],
    [0, 200],
  ]
  const layers = buildOrientationLayers([horizontal, vertical], { cellM: 2 })

  it('each street shows up only in its own aligned layer near the other street', () => {
    // Far along the horizontal street, away from the crossing: only layer 0
    // (horizontal) is close; the vertical layer is far.
    const alongHorizontal: [number, number] = [150, 0]
    expect(layers.distanceAt(0, alongHorizontal)).toBeCloseTo(0, 0)
    expect(layers.distanceAt(ORIENTATION_LAYERS / 2, alongHorizontal)).toBeCloseTo(150, 0)
  })
})
