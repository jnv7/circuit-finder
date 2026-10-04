// Builds a `porto-streets.json`-shaped document (Phase 3's schema) from raw
// Overpass ways, for an arbitrary region (Phase 26) — not just Porto. Pure;
// the Overpass fetch lives in http.ts/overpass.ts, the CLI wiring in
// scripts/extract-region.ts. Mirrors the one-off pipeline documented in
// src/data/porto-streets.schema.md (clip to bbox, simplify at 5 m, quantise
// to a 1e-5° lattice, delta-encode) so `src/streets.ts`'s existing
// `validateStreetNetwork`/`loadStreetNetwork` reads the result unchanged.
import type { Attribution } from '../attribution'
import { bboxCenterProjection } from '../geo'
import type { LonLat } from '../geo'
import { simplify } from '../geometry/simplify'
import { RUNNABLE_HIGHWAY_CLASSES } from './overpass'
import type { OsmWay } from './overpass'

/** Douglas-Peucker tolerance, metres — matches porto-streets.json's own pipeline. */
export const SIMPLIFY_TOLERANCE_M = 5
/** Quantisation lattice step, degrees — matches porto-streets.json (≈ 0.56-1.1 m). */
export const GRID_DEG = 1e-5

export type BBox = readonly [number, number, number, number]

export type StreetNetworkFile = {
  bbox: BBox
  grid: number
  attribution: Attribution
  ways: number[][]
}

const RUNNABLE = new Set<string>(RUNNABLE_HIGHWAY_CLASSES)

function insideBbox([lon, lat]: LonLat, bbox: BBox): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

/** Split a way's points into runs that lie fully inside `bbox`; drops runs under 2 points. */
export function clipToBbox(points: readonly LonLat[], bbox: BBox): LonLat[][] {
  const runs: LonLat[][] = []
  let current: LonLat[] = []
  for (const p of points) {
    if (insideBbox(p, bbox)) current.push(p)
    else if (current.length > 0) {
      runs.push(current)
      current = []
    }
  }
  if (current.length > 0) runs.push(current)
  return runs.filter((r) => r.length >= 2)
}

/**
 * Quantise to the `grid`-degree lattice anchored at `bbox`'s south-west
 * corner, drop consecutive duplicate lattice points, delta-encode. Returns
 * `undefined` when fewer than 2 distinct lattice points remain (way too
 * short to keep, matching `validateStreetNetwork`'s own minimum).
 */
export function quantiseAndEncode(points: readonly LonLat[], bbox: BBox, grid: number): number[] | undefined {
  const lattice: Array<[number, number]> = []
  for (const [lon, lat] of points) {
    const x = Math.round((lon - bbox[0]) / grid)
    const y = Math.round((lat - bbox[1]) / grid)
    const last = lattice[lattice.length - 1]
    if (!last || last[0] !== x || last[1] !== y) lattice.push([x, y])
  }
  if (lattice.length < 2) return undefined
  const flat: number[] = [lattice[0]![0], lattice[0]![1]]
  for (let i = 1; i < lattice.length; i++) {
    flat.push(lattice[i]![0] - lattice[i - 1]![0], lattice[i]![1] - lattice[i - 1]![1])
  }
  return flat
}

export type BuildStreetNetworkOptions = {
  simplifyToleranceM?: number
  gridDeg?: number
}

/**
 * Build a `StreetNetworkFile` for `bbox` from raw Overpass ways: keep only
 * runnable highway classes, clip each way to the bbox (Overpass can return a
 * way that only partly falls inside it), simplify in a bbox-centred metric
 * frame, then quantise and delta-encode. Deterministic, offline, no network.
 */
export function buildStreetNetworkFile(
  ways: readonly OsmWay[],
  bbox: BBox,
  attribution: Attribution,
  opts: BuildStreetNetworkOptions = {},
): StreetNetworkFile {
  const toleranceM = opts.simplifyToleranceM ?? SIMPLIFY_TOLERANCE_M
  const grid = opts.gridDeg ?? GRID_DEG
  const project = bboxCenterProjection(bbox)

  const encoded: number[][] = []
  for (const way of ways) {
    if (!RUNNABLE.has(way.tags['highway'] ?? '')) continue
    for (const run of clipToBbox(way.points, bbox)) {
      const metric = run.map((p) => project.toLocal(p))
      const simplified = simplify(metric, toleranceM, false).map((p) => project.toLonLat(p))
      const flat = quantiseAndEncode(simplified, bbox, grid)
      if (flat) encoded.push(flat)
    }
  }

  if (encoded.length === 0) throw new Error('buildStreetNetworkFile: no runnable ways survived clipping/simplification')

  return { bbox, grid, attribution, ways: encoded }
}
