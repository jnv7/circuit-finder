// Traced-route measurements: how long the hand-drawn route is, and how far it
// strays from the placed circuit centreline. All pure and in the shared Porto
// metric frame — the caller projects the route and the centreline ring before
// calling. There is deliberately no single "match %": the numbers are plain
// measurements (metres), the user judges what is close enough. See
// docs/specs/phase-5-trace-and-study.md.
import { distanceToSegment } from '../geometry/nearest'
import { pathLength, resample } from '../geometry/path'
import type { Point } from '../geometry/types'

/** Resample spacing, metres, for the deviation figure. */
export const DEV_SAMPLE_M = 10

export type RouteStats = {
  /** Route length in metres (open polyline). */
  lengthM: number
  /** Mean of every symmetric nearest-distance sample, metres. */
  meanDeviationM: number
  /** Largest nearest-distance sample, metres (Hausdorff-style). */
  maxDeviationM: number
}

/** Length of the traced route (open polyline). */
export function routeLengthM(metricRoute: readonly Point[]): number {
  return pathLength(metricRoute, false)
}

/** Nearest distance from `p` to a polyline (its closing segment included when `closed`). */
function nearestOnPolyline(p: Point, poly: readonly Point[], closed: boolean): number {
  let best = Infinity
  for (let i = 0; i < poly.length - 1; i++) {
    const d = distanceToSegment(p, poly[i]!, poly[i + 1]!)
    if (d < best) best = d
  }
  if (closed && poly.length > 1) {
    const d = distanceToSegment(p, poly[poly.length - 1]!, poly[0]!)
    if (d < best) best = d
  }
  return best
}

/**
 * Symmetric deviation between the traced route (open) and the placed centreline
 * ring (closed), both in Porto-frame metres. Resamples each at `sampleM`, then
 * for every route sample measures the nearest distance to the ring and for
 * every ring sample the nearest distance to the route. Returns the mean over
 * all those samples and the largest single one — so a route that only covers
 * part of the shape still shows a large `maxM` via the ring→route direction.
 */
export function routeDeviation(
  metricRoute: readonly Point[],
  metricRing: readonly Point[],
  opts: { sampleM?: number } = {},
): { meanM: number; maxM: number } {
  const sampleM = opts.sampleM ?? DEV_SAMPLE_M
  const routeSamples = resample(metricRoute, sampleM, false)
  const ringSamples = resample(metricRing, sampleM, true)

  let sum = 0
  let max = 0
  let n = 0
  for (const p of routeSamples) {
    const d = nearestOnPolyline(p, metricRing, true)
    sum += d
    if (d > max) max = d
    n++
  }
  for (const p of ringSamples) {
    const d = nearestOnPolyline(p, metricRoute, false)
    sum += d
    if (d > max) max = d
    n++
  }
  return { meanM: n === 0 ? 0 : sum / n, maxM: max }
}

/**
 * Combined stats for the panel, or `null` when there is nothing meaningful to
 * measure (fewer than two route points, or a zero-length route).
 */
export function routeStats(
  metricRoute: readonly Point[],
  metricRing: readonly Point[],
): RouteStats | null {
  if (metricRoute.length < 2 || metricRing.length < 2) return null
  const lengthM = routeLengthM(metricRoute)
  if (lengthM === 0) return null
  const { meanM, maxM } = routeDeviation(metricRoute, metricRing)
  return { lengthM, meanDeviationM: meanM, maxDeviationM: maxM }
}
