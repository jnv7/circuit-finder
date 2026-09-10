// Rotation from a pointer drag, in the map's screen-pixel space. Pure: the
// caller passes in already-projected pixel coordinates (Leaflet's
// `latLngToContainerPoint` / `containerPointToLatLng` do the projection).
//
// Screen pixel space has x increasing to the right and y increasing DOWNWARD.
// We define the stored `rotationRad` so that:
//   - 0 puts the rotate handle straight up (screen north) from the anchor;
//   - it increases counter-clockwise on screen, which is also counter-clockwise
//     in the local ENU frame (east -> north), so it feeds `overlayLatLngs`
//     directly with no sign flip.

/** A point in screen pixels: [x, y], y downward. */
export type Px = readonly [number, number]

/**
 * Bearing of the drag from `centerPx` to `pointerPx`, in radians, under the sign
 * convention above. `atan2(-dx, -dy)`: pointer directly above the centre -> 0;
 * pointer to the left -> +π/2.
 */
export function bearingFromDrag(centerPx: Px, pointerPx: Px): number {
  const dx = pointerPx[0] - centerPx[0]
  const dy = pointerPx[1] - centerPx[1]
  return Math.atan2(-dx, -dy)
}

/**
 * Where to draw the rotate handle: a fixed pixel distance `pixelRadius` from the
 * anchor, at angle `rotationRad`. Inverse of `bearingFromDrag`, so
 * `bearingFromDrag(c, handlePixel(c, θ, r)) === θ` (mod 2π).
 */
export function handlePixel(centerPx: Px, rotationRad: number, pixelRadius: number): Px {
  return [
    centerPx[0] - pixelRadius * Math.sin(rotationRad),
    centerPx[1] - pixelRadius * Math.cos(rotationRad),
  ]
}
