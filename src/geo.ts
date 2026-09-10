// Geographic <-> local metric projection.
//
// The app does all geometry in a local ENU plane (metres, x = east, y = north).
// For a circuit that spans a few kilometres, an equirectangular projection about
// a reference latitude/longitude is accurate to well under 1%. A proper
// tangent-plane / UTM projection is a possible later refinement.
import type { Point } from './geometry/types'

/** Mean Earth radius (metres), IUGG. */
const EARTH_RADIUS_M = 6371008.8
const DEG = Math.PI / 180

/** A geographic coordinate as stored in circuit data: [longitude, latitude]. */
export type LonLat = readonly [number, number]

export type LocalProjection = {
  readonly origin: LonLat
  /** Project a geographic coordinate to local metres. */
  toLocal(coord: LonLat): Point
  /** Invert: local metres back to a geographic coordinate. */
  toLonLat(point: Point): LonLat
}

/** Mean of a list of geographic coordinates (naive average; fine at this scale). */
export function meanLonLat(coords: readonly LonLat[]): LonLat {
  if (coords.length === 0) throw new Error('meanLonLat: empty list')
  let lon = 0
  let lat = 0
  for (const c of coords) {
    lon += c[0]
    lat += c[1]
  }
  return [lon / coords.length, lat / coords.length]
}

/**
 * Build an equirectangular projection centred on `origin`. Distances near the
 * origin are preserved; distortion grows with distance from it.
 */
export function localProjection(origin: LonLat): LocalProjection {
  const [lon0, lat0] = origin
  const cosLat0 = Math.cos(lat0 * DEG)
  return {
    origin,
    toLocal([lon, lat]) {
      return [EARTH_RADIUS_M * (lon - lon0) * DEG * cosLat0, EARTH_RADIUS_M * (lat - lat0) * DEG]
    },
    toLonLat([x, y]) {
      return [lon0 + x / (EARTH_RADIUS_M * DEG * cosLat0), lat0 + y / (EARTH_RADIUS_M * DEG)]
    },
  }
}

/**
 * Inverse projection: place local-metre points (x = east, y = north, relative
 * to `anchor`) back onto geographic coordinates around `anchor`. Thin wrapper
 * over `localProjection(anchor).toLonLat`, used to drop transformed circuit
 * geometry onto the map.
 */
export function placePoints(points: readonly Point[], anchor: LonLat): LonLat[] {
  const projection = localProjection(anchor)
  return points.map((p) => projection.toLonLat(p))
}

/**
 * Project a ring of geographic coordinates to local metres, centred on the
 * ring's mean coordinate so the result straddles the origin.
 */
export function projectRing(ring: readonly LonLat[]): { points: Point[]; projection: LocalProjection } {
  const projection = localProjection(meanLonLat(ring))
  return { points: ring.map((c) => projection.toLocal(c)), projection }
}
