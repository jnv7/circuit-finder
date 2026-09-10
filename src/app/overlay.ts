// Placement math: take a circuit's metric centreline (metres, centroid at the
// origin) and a hand-chosen placement, and produce the on-map polyline plus the
// live length readout. All pure — no Leaflet, no DOM.
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import { placePoints } from '../geo'
import type { Point } from '../geometry/types'
import { rotate as rotateVec, scale as scaleVec } from '../geometry/vector'

/**
 * A hand placement of a circuit on the map:
 * - `anchor` — where the circuit's centroid sits (lon/lat);
 * - `rotationRad` — rotation about that centroid, counter-clockwise positive,
 *   in the local ENU frame (x = east, y = north), matching the geometry toolkit;
 * - `scale` — uniform multiplier on the real-world size (1 = true 1:1).
 */
export type Placement = {
  anchor: LonLat
  rotationRad: number
  scale: number
}

/**
 * The overlay polyline for `circuit` under `placement`: scale, then rotate about
 * the centroid, then project back to lon/lat around `anchor`. Returns an open
 * ring (first point not repeated); the caller appends the first point to close
 * the Leaflet polyline.
 */
export function overlayLatLngs(circuit: MetricCircuit, placement: Placement): LonLat[] {
  const transformed: Point[] = circuit.metricCentreline.map((p) =>
    rotateVec(scaleVec(p, placement.scale), placement.rotationRad),
  )
  return placePoints(transformed, placement.anchor)
}

/**
 * Lap length and longest straight for the current scale. Independent of anchor
 * and rotation — moving or turning the overlay never changes these.
 */
export function readout(circuit: MetricCircuit, scale: number): { lapM: number; straightM: number } {
  return {
    lapM: circuit.lengthM * scale,
    straightM: circuit.longestStraight.lengthM * scale,
  }
}

/** `"1.85 km"` at 1 km and above, `"940 m"` below. */
export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}
