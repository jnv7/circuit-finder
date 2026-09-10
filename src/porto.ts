// Shared Porto frame of reference. Phases 1-2 project each circuit about its own
// centroid; Phase 3 proximity math needs the circuit overlay and the street
// network in one common metric frame, so it uses a single equirectangular
// projection about a fixed Porto origin. Over the bundled street bbox the
// distortion is < 0.3 %.
import type { LonLat, LocalProjection } from './geo'
import { localProjection } from './geo'

/** Fixed initial map view (Phase 2 decision; tune here only). */
export const PORTO_CENTER: LonLat = [-8.6291, 41.1579]
export const PORTO_ZOOM = 14

/** Origin of the shared metric frame for all Porto-frame geometry. */
export const PORTO_ORIGIN: LonLat = PORTO_CENTER

/** Equirectangular projection shared by all Porto-frame geometry. */
export function portoProjection(): LocalProjection {
  return localProjection(PORTO_ORIGIN)
}
