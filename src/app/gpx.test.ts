// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import type { LonLat } from '../geo'
import { buildGpx, gpxFilename, routeGpx, routeGpxFilename } from './gpx'

const RING: LonLat[] = [
  [-8.61, 41.14],
  [-8.6, 41.15],
  [-8.59, 41.14],
  [-8.6, 41.13],
]

function trkpts(gpx: string): [string, string][] {
  return [...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">/g)].map((m) => [m[1]!, m[2]!])
}

describe('buildGpx', () => {
  it('is well-formed XML with one trk, one trkseg and one trkpt per point, in order', () => {
    const gpx = buildGpx(RING, 'Test')
    const doc = new DOMParser().parseFromString(gpx, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.getElementsByTagName('trk')).toHaveLength(1)
    expect(doc.getElementsByTagName('trkseg')).toHaveLength(1)
    expect(trkpts(gpx)).toEqual(RING.map(([lon, lat]) => [String(lat), String(lon)]))
  })

  it('escapes &, <, > and " in the track name', () => {
    const gpx = buildGpx(RING, 'A & B <c> "d"')
    expect(gpx).toContain('<name>A &amp; B &lt;c&gt; &quot;d&quot;</name>')
    const doc = new DOMParser().parseFromString(gpx, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.getElementsByTagName('name')[0]!.textContent).toBe('A & B <c> "d"')
  })

  it('has no elevation and no timestamps', () => {
    const gpx = buildGpx(RING, 'Test')
    expect(gpx).not.toContain('<ele>')
    expect(gpx).not.toContain('<time>')
  })
})

describe('gpxFilename', () => {
  it('is <id>-<YYYY-MM-DD>.gpx from the injected date', () => {
    expect(gpxFilename('hungaroring', new Date('2026-09-15T12:00:00Z'))).toBe('hungaroring-2026-09-15.gpx')
  })
})

describe('routeGpx', () => {
  it('exports a stored open ring as a closed loop: n + 1 points, the last equal to the first', () => {
    const points = trkpts(routeGpx('Hungaroring', 1, RING))
    expect(points).toHaveLength(RING.length + 1)
    expect(points[points.length - 1]).toEqual(points[0])
  })

  it('names the track "<circuit> — route <rank>"', () => {
    expect(routeGpx('Silverstone Circuit', 2, RING)).toContain('<name>Silverstone Circuit — route 2</name>')
  })

  it('refuses a route with fewer than 2 points', () => {
    expect(() => routeGpx('X', 1, [])).toThrow()
    expect(() => routeGpx('X', 1, [[-8.6, 41.1]])).toThrow()
  })
})

describe('routeGpxFilename', () => {
  it('is <circuitId>-route-<rank>.gpx', () => {
    expect(routeGpxFilename('hungaroring', 2)).toBe('hungaroring-route-2.gpx')
  })
})
