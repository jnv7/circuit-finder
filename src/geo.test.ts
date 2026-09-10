import { describe, it, expect } from 'vitest'
import { localProjection, meanLonLat, placePoints, projectRing } from './geo'
import type { LonLat } from './geo'
import { distance } from './geometry/vector'

describe('geo', () => {
  it('places the origin at [0, 0] and inverts round-trip', () => {
    const origin: LonLat = [7.42, 43.73]
    const proj = localProjection(origin)
    expect(proj.toLocal(origin)[0]).toBeCloseTo(0, 9)
    expect(proj.toLocal(origin)[1]).toBeCloseTo(0, 9)

    const sample: LonLat = [7.44, 43.74]
    const round = proj.toLonLat(proj.toLocal(sample))
    expect(round[0]).toBeCloseTo(sample[0], 9)
    expect(round[1]).toBeCloseTo(sample[1], 9)
  })

  it('north and east distances match known scales', () => {
    const proj = localProjection([0, 0])
    // 1 degree of latitude ~= 111.2 km near the equator
    expect(proj.toLocal([0, 1])[1] / 1000).toBeCloseTo(111.195, 1)
    // at the equator 1 degree of longitude ~= the same
    expect(proj.toLocal([1, 0])[0] / 1000).toBeCloseTo(111.195, 1)
  })

  it('measures a ~60 km separation consistently with the haversine value', () => {
    const a: LonLat = [2.2, 41.7]
    const b: LonLat = [2.82, 41.98]
    const proj = localProjection([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
    const planar = distance(proj.toLocal(a), proj.toLocal(b))

    const R = 6371008.8
    const toRad = Math.PI / 180
    const dLat = (b[1] - a[1]) * toRad
    const dLon = (b[0] - a[0]) * toRad
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2
    const haversine = 2 * R * Math.asin(Math.sqrt(h))

    expect(Math.abs(planar - haversine) / haversine).toBeLessThan(0.005)
  })

  it('meanLonLat averages coordinates', () => {
    expect(meanLonLat([[0, 0], [2, 4], [4, 8]])).toEqual([2, 4])
  })

  it('placePoints drops local metres onto lon/lat around an anchor', () => {
    const anchor: LonLat = [-8.6291, 41.1579]
    // origin stays at the anchor; +x is east, +y is north.
    const [origin, east, north] = placePoints([[0, 0], [1000, 0], [0, 1000]], anchor)
    expect(origin![0]).toBeCloseTo(anchor[0], 9)
    expect(origin![1]).toBeCloseTo(anchor[1], 9)
    expect(east![0]).toBeGreaterThan(anchor[0])
    expect(east![1]).toBeCloseTo(anchor[1], 9)
    expect(north![1]).toBeGreaterThan(anchor[1])
    expect(north![0]).toBeCloseTo(anchor[0], 9)
  })

  it('projectRing centres the ring near the origin', () => {
    const ring: LonLat[] = [
      [2.25, 41.56],
      [2.26, 41.57],
      [2.27, 41.56],
      [2.26, 41.55],
    ]
    const { points } = projectRing(ring)
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length
    expect(cx).toBeCloseTo(0, 6)
    expect(cy).toBeCloseTo(0, 6)
  })
})
