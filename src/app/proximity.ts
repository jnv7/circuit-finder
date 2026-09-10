// Street-proximity feedback (pure). Given a circuit overlay ring in the Porto
// metric frame and the street index, colour each segment by how much of its
// length sits near a real street. A hint, not a verdict: no score, no snap.
import type { Point } from '../geometry/types'
import { distance } from '../geometry/vector'
import type { StreetIndex } from '../streets'

/** A sample is "on a street" within this distance, metres. */
export const NEAR_M = 10
/** Spacing of coverage samples along a segment, metres. */
export const SAMPLE_M = 5
/** Colour buckets for rendering, so the layer count stays bounded. */
export const LEVELS = 8

/** Ramp stops: coverage 1 → green, 0.5 → amber, 0 → red. */
const RAMP = {
  green: [0x2e, 0x7d, 0x32],
  amber: [0xf9, 0xa8, 0x25],
  red: [0xc6, 0x28, 0x28],
} as const

export type SegmentProximity = {
  /** Fraction (0…1) of the segment's samples within `nearM` of a street. */
  coverage: number
  /** `#rrggbb` from the ramp. */
  color: string
}

export type LapProximity = {
  segments: SegmentProximity[]
  /** Length-weighted mean coverage over the closed ring. */
  nearFraction: number
}

export type ProximityOptions = {
  nearM?: number
  sampleM?: number
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
}

/** Continuous green → amber → red lerp on `coverage` (0…1). Returns `#rrggbb`. */
export function proximityColor(coverage: number): string {
  const c = Math.max(0, Math.min(1, coverage))
  const [from, to, t] =
    c >= 0.5
      ? [RAMP.amber, RAMP.green, (c - 0.5) / 0.5]
      : [RAMP.red, RAMP.amber, c / 0.5]
  const rgb = [0, 1, 2].map((i) => lerpChannel(from[i]!, to[i]!, t))
  return `#${rgb.map(hex2).join('')}`
}

/** Bucket index in `0…levels-1` for a coverage value, monotonic in coverage. */
export function quantize(coverage: number, levels = LEVELS): number {
  const c = Math.max(0, Math.min(1, coverage))
  return Math.min(levels - 1, Math.floor(c * levels))
}

/** Coverage of one segment: the fraction of its samples near a street. */
function segmentCoverage(a: Point, b: Point, index: StreetIndex, nearM: number, sampleM: number): number {
  const len = distance(a, b)
  const steps = Math.max(1, Math.round(len / sampleM))
  let near = 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    if (index.nearestDistanceM(p, nearM) < nearM) near++
  }
  return near / (steps + 1)
}

/**
 * Per-segment street coverage and colour for a circuit overlay ring, plus the
 * length-weighted mean coverage over the whole closed lap.
 */
export function lapProximity(
  metricRing: readonly Point[],
  index: StreetIndex,
  opts: ProximityOptions = {},
): LapProximity {
  const nearM = opts.nearM ?? NEAR_M
  const sampleM = opts.sampleM ?? SAMPLE_M

  const segments: SegmentProximity[] = []
  let weighted = 0
  let total = 0

  for (let i = 0; i < metricRing.length; i++) {
    const a = metricRing[i]!
    const b = metricRing[(i + 1) % metricRing.length]!
    const coverage = segmentCoverage(a, b, index, nearM, sampleM)
    segments.push({ coverage, color: proximityColor(coverage) })
    const len = distance(a, b)
    weighted += coverage * len
    total += len
  }

  return { segments, nearFraction: total === 0 ? 0 : weighted / total }
}
