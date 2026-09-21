// GPX 1.1 export: pure string building, no DOM. `buildGpx`/`gpxFilename` are
// Phase 18's contract (docs/specs/phase-18-gpx-export.md), written here first
// because Phase 23's routes page needs them sooner than Phase 18's own button;
// `routeGpx`/`routeGpxFilename` are the stored-route variants (Phase 23). A
// `<trk>` (a path to follow), with no elevation and no timestamps.
import type { LonLat } from '../geo'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Build a GPX 1.1 document containing one `<trk>` with a single `<trkseg>`
 *  of the given points, in order. */
export function buildGpx(points: readonly LonLat[], trackName: string): string {
  const trkpts = points
    .map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="circuit-finder" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(trackName)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

/** "hungaroring-2026-09-15.gpx". Pure — `now` injected for testability. */
export function gpxFilename(circuitId: string, now: Date): string {
  return `${circuitId}-${now.toISOString().slice(0, 10)}.gpx`
}

/** A stored route as a GPX document. Stored routes are open rings (the first
 *  point is not repeated), so the loop is closed here by appending it. */
export function routeGpx(circuitName: string, rank: number, ring: readonly LonLat[]): string {
  const first = ring[0]
  if (first === undefined || ring.length < 2) throw new Error('routeGpx: a route needs at least 2 points')
  return buildGpx([...ring, first], `${circuitName} — route ${rank}`)
}

/** "hungaroring-route-2.gpx" — a stored route has no "today", only a rank. */
export function routeGpxFilename(circuitId: string, rank: number): string {
  return `${circuitId}-route-${rank}.gpx`
}
