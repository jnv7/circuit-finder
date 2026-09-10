// Bundled Porto street network: a normalised, simplified copy of OpenStreetMap
// "runnable" ways (ODbL), stored compactly and indexed in a uniform spatial
// grid so nearest-street distance is a pure, fast, offline query. The app never
// calls Overpass at runtime. See src/data/porto-streets.schema.md.
import rawStreets from './data/porto-streets.json'
import type { Attribution } from './attribution'
import { validateAttribution } from './attribution'
import type { LonLat } from './geo'
import type { Point } from './geometry/types'
import { closestPointOnSegment } from './geometry/nearest'
import { distance } from './geometry/vector'
import { portoProjection } from './porto'

/** Spatial grid cell size, metres. */
export const CELL_M = 50

/** `[west, south, east, north]`. */
export type BBox = readonly [number, number, number, number]

/** A single street as a polyline in Porto-frame metres. */
export type Street = readonly Point[]

export type StreetNetwork = {
  bbox: BBox
  attribution: Attribution
  /** Streets projected into the Porto metric frame. */
  ways: Street[]
}

/** Coords must fall inside the bbox expanded by this many degrees. */
const BBOX_EPSILON = 0.002

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Decode one compact way (a flat array of quantised integers
 * `[x0, y0, dx1, dy1, ...]` on a `grid`-degree lattice anchored at the bbox
 * south-west corner) back to `[lon, lat]` pairs.
 */
function decodeWay(flat: readonly number[], bbox: BBox, grid: number): LonLat[] {
  const out: LonLat[] = []
  let x = flat[0]!
  let y = flat[1]!
  out.push([bbox[0] + x * grid, bbox[1] + y * grid])
  for (let i = 2; i < flat.length; i += 2) {
    x += flat[i]!
    y += flat[i + 1]!
    out.push([bbox[0] + x * grid, bbox[1] + y * grid])
  }
  return out
}

/**
 * Validate arbitrary data as the bundled street network and return it with the
 * ways decoded to `[lon, lat]`. Throws with a descriptive message on the first
 * problem found.
 */
export function validateStreetNetwork(data: unknown): {
  bbox: BBox
  attribution: Attribution
  ways: LonLat[][]
} {
  if (typeof data !== 'object' || data === null) {
    throw new Error('street network must be an object')
  }
  const record = data as Record<string, unknown>

  const rawBbox = record['bbox']
  if (
    !Array.isArray(rawBbox) ||
    rawBbox.length !== 4 ||
    !rawBbox.every(isFiniteNumber)
  ) {
    throw new Error('street network bbox must be four finite numbers')
  }
  const bbox = rawBbox as unknown as BBox
  if (!(bbox[0] < bbox[2])) throw new Error('street network bbox west must be < east')
  if (!(bbox[1] < bbox[3])) throw new Error('street network bbox south must be < north')

  const grid = record['grid']
  if (!isFiniteNumber(grid) || grid <= 0) {
    throw new Error('street network grid must be a positive number')
  }

  const attribution = validateAttribution(record['attribution'], 'street network')

  const rawWays = record['ways']
  if (!Array.isArray(rawWays) || rawWays.length === 0) {
    throw new Error('street network ways must be a non-empty array')
  }

  const ways: LonLat[][] = rawWays.map((flat, w) => {
    const where = `street network way ${w}`
    if (
      !Array.isArray(flat) ||
      flat.length < 4 ||
      flat.length % 2 !== 0 ||
      !flat.every((n) => isFiniteNumber(n) && Number.isInteger(n))
    ) {
      throw new Error(`${where} must be an even-length array of at least 4 integers`)
    }
    const points = decodeWay(flat, bbox, grid)
    points.forEach(([lon, lat], i) => {
      if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
        throw new Error(`${where} point ${i} is not a finite [lon, lat] pair`)
      }
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        throw new Error(`${where} point ${i} is out of range`)
      }
      if (
        lon < bbox[0] - BBOX_EPSILON ||
        lon > bbox[2] + BBOX_EPSILON ||
        lat < bbox[1] - BBOX_EPSILON ||
        lat > bbox[3] + BBOX_EPSILON
      ) {
        throw new Error(`${where} point ${i} lies outside the bbox`)
      }
    })
    for (let i = 1; i < points.length; i++) {
      if (
        Math.abs(points[i]![0] - points[i - 1]![0]) < 1e-9 &&
        Math.abs(points[i]![1] - points[i - 1]![1]) < 1e-9
      ) {
        throw new Error(`${where} has a repeated point at ${i}`)
      }
    }
    return points
  })

  return { bbox, attribution, ways }
}

/** Load, validate, and project the bundled Porto street network. */
export function loadStreetNetwork(): StreetNetwork {
  const { bbox, attribution, ways } = validateStreetNetwork(rawStreets)
  const project = portoProjection()
  return {
    bbox,
    attribution,
    ways: ways.map((way) => way.map((c) => project.toLocal(c))),
  }
}

export type StreetIndex = {
  /** Distance to the nearest street point, capped at `maxM`. */
  nearestDistanceM(p: Point, maxM: number): number
  /**
   * The nearest point on any street within `maxM`, or `null` when nothing is in
   * range. `distanceM` is capped at `maxM` and equals `nearestDistanceM(p, maxM)`.
   */
  nearestPointM(p: Point, maxM: number): { distanceM: number; point: Point | null }
}

type Segment = readonly [Point, Point]

/**
 * A uniform grid over the Porto frame. Each street segment is inserted into
 * every cell its bounding box touches; a nearest query scans the cells covering
 * `[p - maxM, p + maxM]`. Built once on load; pure and offline.
 */
export function buildStreetIndex(ways: readonly Street[], cellM = CELL_M): StreetIndex {
  if (!(cellM > 0)) throw new Error('buildStreetIndex: cellM must be > 0')

  const cells = new Map<string, Segment[]>()
  const key = (cx: number, cy: number): string => `${cx},${cy}`

  for (const way of ways) {
    for (let i = 1; i < way.length; i++) {
      const a = way[i - 1]!
      const b = way[i]!
      const seg: Segment = [a, b]
      const minX = Math.min(a[0], b[0])
      const maxX = Math.max(a[0], b[0])
      const minY = Math.min(a[1], b[1])
      const maxY = Math.max(a[1], b[1])
      for (let cx = Math.floor(minX / cellM); cx <= Math.floor(maxX / cellM); cx++) {
        for (let cy = Math.floor(minY / cellM); cy <= Math.floor(maxY / cellM); cy++) {
          const k = key(cx, cy)
          const bucket = cells.get(k)
          if (bucket) bucket.push(seg)
          else cells.set(k, [seg])
        }
      }
    }
  }

  /**
   * Scan the cells covering `[p - maxM, p + maxM]` for the nearest segment. A
   * segment straddling several cells may be tested more than once — cheaper than
   * de-duplicating, and the running minimum is unaffected.
   */
  function scan(p: Point, maxM: number): { distanceM: number; point: Point | null } {
    let best = maxM
    let bestPoint: Point | null = null
    const cx0 = Math.floor((p[0] - maxM) / cellM)
    const cx1 = Math.floor((p[0] + maxM) / cellM)
    const cy0 = Math.floor((p[1] - maxM) / cellM)
    const cy1 = Math.floor((p[1] + maxM) / cellM)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = cells.get(key(cx, cy))
        if (!bucket) continue
        for (const seg of bucket) {
          const foot = closestPointOnSegment(p, seg[0], seg[1])
          const d = distance(p, foot)
          if (d < best) {
            best = d
            bestPoint = foot
          }
        }
      }
    }
    return { distanceM: best, point: bestPoint }
  }

  return {
    nearestDistanceM: (p, maxM) => scan(p, maxM).distanceM,
    nearestPointM: (p, maxM) => scan(p, maxM),
  }
}
