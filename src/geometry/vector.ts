// Pure 2D vector helpers on `Point` (metres).
import type { Point } from './types'

export function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]]
}

export function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]]
}

export function scale(v: Point, k: number): Point {
  return [v[0] * k, v[1] * k]
}

/** Rotate `v` about the origin by `rad` radians, counter-clockwise. */
export function rotate(v: Point, rad: number): Point {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

export function length(v: Point): number {
  return Math.hypot(v[0], v[1])
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1]
}

/** 2D cross product (z-component of the 3D cross). */
export function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0]
}

/** Unit vector in the direction of `v`. Returns [0, 0] for a zero vector. */
export function normalize(v: Point): Point {
  const len = Math.hypot(v[0], v[1])
  return len === 0 ? [0, 0] : [v[0] / len, v[1] / len]
}

/**
 * Signed angle from `a` to `b` in radians, in (-π, π]. Counter-clockwise is
 * positive. Zero if either vector is zero.
 */
export function angleBetween(a: Point, b: Point): number {
  return Math.atan2(cross(a, b), dot(a, b))
}
