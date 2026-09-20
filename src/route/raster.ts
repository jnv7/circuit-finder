// Phase 22, stage 1a: rasterise the street network into orientation layers, so
// an exhaustive pose search can ask "is there a street here, running roughly
// this way?" as an O(1) grid lookup instead of a spatial nearest-segment scan
// per sample. Each layer covers a slice of heading (mod 180 degrees — a
// street runs "along" a line, direction of travel doesn't matter) and holds
// the exact Euclidean distance transform (Felzenszwalb & Huttenlocher's
// linear-time squared-distance algorithm, two 1D passes) to the nearest
// street segment whose own heading falls within `alignDeg` of the layer's
// centre. See docs/specs/phase-22-route-generator.md.
import type { Point } from '../geometry/types'
import type { Street } from '../streets'

/** Raster cell size, metres. Tolerance in later stages is 50-100 m, so a 5 m
 *  cell is ample resolution without an unreasonable grid size. */
export const CELL_M = 5

/** Number of orientation layers, evenly covering the 0-180° heading range
 *  (mod 180 — a street's direction of travel doesn't matter). */
export const ORIENTATION_LAYERS = 12

/** A street segment contributes to a layer when its own heading (mod 180) is
 *  within this many degrees of the layer's centre — wider than one layer's
 *  own 15° bin, so a segment can be a source in more than one layer. */
export const ALIGN_DEG = 35

export type OrientationLayers = {
  readonly cellM: number
  readonly layerCount: number
  readonly alignDeg: number
  readonly minX: number
  readonly minY: number
  /** Layer `i`'s centre heading, radians, in `[0, π)`. */
  layerHeadingRad(layer: number): number
  /** Exact distance (metres) from `p` to the nearest source cell of `layer`,
   *  or `Infinity` when `p` falls outside the rasterised bounds. */
  distanceAt(layer: number, p: Point): number
}

/** Smallest difference between two headings, both taken mod π (radians),
 *  in `[0, π/2]`. */
function headingDeltaMod180(a: number, b: number): number {
  const pi = Math.PI
  let d = Math.abs(a - b) % pi
  if (d > pi / 2) d = pi - d
  return d
}

/**
 * A finite stand-in for "no source here", far larger than any squared
 * distance this grid can produce (bounded by its own dimensions) — keeps every
 * intersection computation finite (no `Infinity - Infinity`), while still
 * dwarfing every real, in-bounds distance once the final `sqrt` is taken.
 */
const NO_SOURCE = 1e15

/**
 * Exact 1D squared-distance transform of a sampled function `f` (0 at a
 * source, `NO_SOURCE` elsewhere): the lower envelope of unit parabolas rooted
 * at each source, evaluated at every index. Felzenszwalb & Huttenlocher,
 * "Distance Transforms of Sampled Functions" (2004) — linear time, exact.
 */
function distanceTransform1D(f: readonly number[]): Float64Array {
  const n = f.length
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = 0
    for (;;) {
      const vk = v[k]!
      s = (f[q]! + q * q - (f[vk]! + vk * vk)) / (2 * q - 2 * vk)
      if (k > 0 && s <= z[k]!) {
        k--
      } else break
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const vk = v[k]!
    d[q] = (q - vk) * (q - vk) + f[vk]!
  }
  return d
}

/** 2D exact squared-distance transform: 1D transform down every column, then
 *  across every row of the result (standard separable composition). */
function distanceTransform2D(source: Float64Array, width: number, height: number): Float64Array {
  const afterColumns = new Float64Array(width * height)
  const column = new Array<number>(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = source[y * width + x]!
    const transformed = distanceTransform1D(column)
    for (let y = 0; y < height; y++) afterColumns[y * width + x] = transformed[y]!
  }
  const result = new Float64Array(width * height)
  const row = new Array<number>(width)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = afterColumns[y * width + x]!
    const transformed = distanceTransform1D(row)
    for (let x = 0; x < width; x++) result[y * width + x] = transformed[x]!
  }
  return result
}

/** Every grid cell a segment passes through (Bresenham-style walk, one cell
 *  per `cellM/2` of arc length — dense enough that no cell along a segment
 *  longer than a cell is skipped). */
function* cellsAlongSegment(a: Point, b: Point, cellM: number, minX: number, minY: number): Generator<number[]> {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const steps = Math.max(1, Math.ceil(len / (cellM / 2)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = a[0] + (b[0] - a[0]) * t
    const y = a[1] + (b[1] - a[1]) * t
    yield [Math.floor((x - minX) / cellM), Math.floor((y - minY) / cellM)]
  }
}

/**
 * Rasterise `ways` into `layerCount` orientation layers over their combined
 * bounds (padded by one cell on every side). Each layer's `distanceAt` is the
 * exact distance to the nearest cell a street segment aligned within
 * `alignDeg` of that layer's heading passed through.
 */
export function buildOrientationLayers(
  ways: readonly Street[],
  opts: { cellM?: number; layerCount?: number; alignDeg?: number; marginM?: number } = {},
): OrientationLayers {
  const cellM = opts.cellM ?? CELL_M
  const layerCount = opts.layerCount ?? ORIENTATION_LAYERS
  const alignDeg = opts.alignDeg ?? ALIGN_DEG
  const alignRad = (alignDeg * Math.PI) / 180

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const way of ways) {
    for (const [x, y] of way) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) {
    // No geometry at all — every query is out of bounds.
    minX = 0
    minY = 0
    maxX = 0
    maxY = 0
  }
  // Padded well beyond one cell: a candidate pose or map-match search can
  // legitimately query a point beyond the tight bounds of the street
  // geometry itself (near the edge of the bundled bbox), up to the widest
  // escalation tier's search radius (150 m) — a query that fell just short of
  // that would wrongly read as "out of bounds" instead of "no street this far".
  const marginM = opts.marginM ?? 200
  minX -= marginM
  minY -= marginM
  maxX += marginM
  maxY += marginM
  const width = Math.max(1, Math.ceil((maxX - minX) / cellM) + 1)
  const height = Math.max(1, Math.ceil((maxY - minY) / cellM) + 1)

  const layerHeadingRad = (layer: number): number => (layer * Math.PI) / layerCount

  // Stored as Float32 (halves the memory of the real bundled network's 12
  // grids — several million cells each) — plenty of precision for metre-scale
  // distances; only the intermediate transform math needs double precision.
  const distanceGrids: Float32Array[] = []
  for (let layer = 0; layer < layerCount; layer++) {
    const centre = layerHeadingRad(layer)
    const source = new Float64Array(width * height).fill(NO_SOURCE)
    let anySource = false
    for (const way of ways) {
      for (let i = 1; i < way.length; i++) {
        const a = way[i - 1]!
        const b = way[i]!
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        if (dx === 0 && dy === 0) continue
        const heading = Math.atan2(dy, dx)
        if (headingDeltaMod180(heading, centre) > alignRad) continue
        for (const [cx, cy] of cellsAlongSegment(a, b, cellM, minX, minY)) {
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue
          source[cy * width + cx] = 0
          anySource = true
        }
      }
    }
    if (!anySource) {
      distanceGrids.push(new Float32Array(width * height).fill(Infinity))
      continue
    }
    distanceGrids.push(Float32Array.from(distanceTransform2D(source, width, height)))
  }

  function distanceAt(layer: number, p: Point): number {
    const cx = Math.floor((p[0] - minX) / cellM)
    const cy = Math.floor((p[1] - minY) / cellM)
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return Infinity
    const sq = distanceGrids[layer]![cy * width + cx]!
    return sq === Infinity ? Infinity : Math.sqrt(sq) * cellM
  }

  return { cellM, layerCount, alignDeg, minX, minY, layerHeadingRad, distanceAt }
}
