// Shared geometry types. All coordinates are metres in a local ENU plane
// (x = east, y = north). Angles are radians, counter-clockwise positive.

/** A 2D point in metres: [x, y]. */
export type Point = readonly [number, number]

/**
 * An ordered list of points. A "ring" is an open polyline whose first and last
 * points are *not* repeated; the closing segment (last → first) is implied and
 * included by the `closed` option on functions that take one.
 */
export type Path = readonly Point[]

/**
 * A similarity transform: uniform positive scale, then rotation, then
 * translation. No reflection — orientation is always preserved.
 */
export type SimilarityTransform = {
  readonly translate: Point
  /** Radians, counter-clockwise. */
  readonly rotation: number
  /** Uniform scale factor, strictly greater than 0. */
  readonly scale: number
}

/** The longest near-straight run found along a path. */
export type Straight = {
  /** Index of the run's first point in the source path. */
  readonly startIndex: number
  /** Index of the run's last point (inclusive; may be < startIndex if it wraps). */
  readonly endIndex: number
  /** Summed segment length along the run, in metres. */
  readonly lengthM: number
  /** Direction from the run's first point to its last, as atan2(dy, dx) radians. */
  readonly bearing: number
}
