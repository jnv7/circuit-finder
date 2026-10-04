import { describe, it, expect } from 'vitest'
import { validateStreetNetwork } from '../streets'
import type { OsmWay } from './overpass'
import { buildStreetNetworkFile, clipToBbox, quantiseAndEncode } from './streetNetwork'

const BBOX = [-8.65, 40.96, -8.59, 41.03] as const
const ATTRIBUTION = {
  source: 'OpenStreetMap contributors',
  license: 'ODbL 1.0',
  url: 'https://www.openstreetmap.org/copyright',
  retrieved: '2026-10-03',
}

function way(id: number, highway: string, points: Array<[number, number]>): OsmWay {
  return { id, nodeIds: points.map((_, i) => i), points, tags: { highway }, inRelation: false }
}

describe('clipToBbox', () => {
  it('keeps points inside the bbox and drops a run that leaves it, under 2 points', () => {
    const points: Array<[number, number]> = [
      [-8.6, 41.0],
      [-8.6, 41.01],
      [-8.4, 41.01], // outside (east of bbox)
      [-8.61, 40.98],
      [-8.61, 40.99],
    ]
    expect(clipToBbox(points, BBOX)).toEqual([
      [points[0], points[1]],
      [points[3], points[4]],
    ])
  })

  it('drops a lone in-bbox point surrounded by out-of-bbox points', () => {
    const points: Array<[number, number]> = [
      [-8.4, 41.0],
      [-8.6, 41.0],
      [-8.4, 41.0],
    ]
    expect(clipToBbox(points, BBOX)).toEqual([])
  })
})

describe('quantiseAndEncode', () => {
  it('encodes the first point absolute, the rest as deltas', () => {
    const grid = 1e-5
    const points: Array<[number, number]> = [
      [BBOX[0] + 100 * grid, BBOX[1] + 100 * grid],
      [BBOX[0] + 120 * grid, BBOX[1] + 100 * grid],
      [BBOX[0] + 120 * grid, BBOX[1] + 90 * grid],
    ]
    expect(quantiseAndEncode(points, BBOX, grid)).toEqual([100, 100, 20, 0, 0, -10])
  })

  it('drops consecutive points that quantise to the same lattice cell', () => {
    const grid = 1e-5
    const points: Array<[number, number]> = [
      [BBOX[0] + 100 * grid, BBOX[1] + 100 * grid],
      [BBOX[0] + 100 * grid + 1e-9, BBOX[1] + 100 * grid], // collapses onto the same cell
      [BBOX[0] + 140 * grid, BBOX[1] + 100 * grid],
    ]
    expect(quantiseAndEncode(points, BBOX, grid)).toEqual([100, 100, 40, 0])
  })

  it('returns undefined when fewer than 2 distinct lattice points remain', () => {
    expect(quantiseAndEncode([[BBOX[0], BBOX[1]]], BBOX, 1e-5)).toBeUndefined()
  })
})

describe('buildStreetNetworkFile', () => {
  it('keeps only runnable highway classes', () => {
    const ways = [
      way(1, 'residential', [[-8.62, 41.0], [-8.615, 41.0], [-8.61, 41.0]]),
      way(2, 'motorway', [[-8.62, 41.0], [-8.61, 41.0]]),
    ]
    const file = buildStreetNetworkFile(ways, BBOX, ATTRIBUTION)
    expect(file.ways).toHaveLength(1)
  })

  it('produces a document the bundled loader accepts unchanged', () => {
    const ways = [
      way(1, 'residential', [[-8.62, 41.0], [-8.615, 41.0], [-8.61, 41.0], [-8.605, 40.99]]),
      way(2, 'footway', [[-8.6, 40.98], [-8.598, 40.981], [-8.596, 40.979]]),
    ]
    const file = buildStreetNetworkFile(ways, BBOX, ATTRIBUTION)
    const { bbox, attribution, ways: decoded } = validateStreetNetwork(file)
    expect(bbox).toEqual(BBOX)
    expect(attribution.license).toMatch(/ODbL/)
    expect(decoded.length).toBe(2)
  })

  it('clips a way that leaves the bbox to its in-bbox run', () => {
    const ways = [way(1, 'residential', [[-8.62, 41.0], [-8.615, 41.0], [-8.4, 41.0], [-8.605, 40.99]])]
    const file = buildStreetNetworkFile(ways, BBOX, ATTRIBUTION)
    const { ways: decoded } = validateStreetNetwork(file)
    expect(decoded).toHaveLength(1)
    for (const [lon] of decoded[0]!) expect(lon).toBeLessThanOrEqual(BBOX[2])
  })

  it('throws rather than write an empty network', () => {
    const ways = [way(1, 'motorway', [[-8.62, 41.0], [-8.61, 41.0]])]
    expect(() => buildStreetNetworkFile(ways, BBOX, ATTRIBUTION)).toThrow(/no runnable ways/)
  })
})
