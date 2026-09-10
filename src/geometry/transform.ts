// Similarity transforms: uniform positive scale, then rotation, then translation.
// No reflection.
import type { Path, Point, SimilarityTransform } from './types'
import { add, rotate, scale as scaleVec } from './vector'

export const IDENTITY: SimilarityTransform = {
  translate: [0, 0],
  rotation: 0,
  scale: 1,
}

/** Apply `t` to a point: scale about the origin, then rotate, then translate. */
export function apply(t: SimilarityTransform, p: Point): Point {
  return add(rotate(scaleVec(p, t.scale), t.rotation), t.translate)
}

export function transformPath(t: SimilarityTransform, path: Path): Point[] {
  return path.map((p) => apply(t, p))
}

/**
 * The transform equivalent to applying `b` first, then `a`:
 * `apply(compose(a, b), p) === apply(a, apply(b, p))`.
 */
export function compose(a: SimilarityTransform, b: SimilarityTransform): SimilarityTransform {
  return {
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    translate: add(rotate(scaleVec(b.translate, a.scale), a.rotation), a.translate),
  }
}

/** The inverse transform: `compose(invert(t), t)` is the identity (up to fp error). */
export function invert(t: SimilarityTransform): SimilarityTransform {
  const scale = 1 / t.scale
  const rotation = -t.rotation
  return {
    scale,
    rotation,
    translate: rotate(scaleVec(t.translate, -scale), rotation),
  }
}
