// Procrustes fit: the best similarity transform (uniform scale, rotation,
// translation — no reflection) between two ordered point sets, in closed form,
// and the RMS residual left over. Phase 6 uses the residual to ask "do the
// near-street points actually trace the circuit's shape?". All pure.
import type { Point, SimilarityTransform } from './types'
import { apply } from './transform'

/**
 * Least-squares similarity transform (scale > 0, rotation, translation, no
 * reflection) mapping `from` onto `to`. `from` and `to` must be the same
 * non-zero length. When `from` is a single repeated point the scale is
 * undefined and returned as 1.
 */
export function fitSimilarity(from: readonly Point[], to: readonly Point[]): SimilarityTransform {
  const n = from.length
  if (n === 0 || n !== to.length) {
    throw new Error('fitSimilarity: inputs must be the same non-zero length')
  }

  let fx = 0
  let fy = 0
  let tx = 0
  let ty = 0
  for (let i = 0; i < n; i++) {
    fx += from[i]![0]
    fy += from[i]![1]
    tx += to[i]![0]
    ty += to[i]![1]
  }
  fx /= n
  fy /= n
  tx /= n
  ty /= n

  // a = Σ f'·t', b = Σ f' × t' (cross); the optimal rotation is atan2(b, a) and
  // the optimal scale is |(a, b)| / Σ|f'|².
  let a = 0
  let b = 0
  let normFrom = 0
  for (let i = 0; i < n; i++) {
    const dfx = from[i]![0] - fx
    const dfy = from[i]![1] - fy
    const dtx = to[i]![0] - tx
    const dty = to[i]![1] - ty
    a += dfx * dtx + dfy * dty
    b += dfx * dty - dfy * dtx
    normFrom += dfx * dfx + dfy * dfy
  }

  const rotation = Math.atan2(b, a)
  const mag = Math.hypot(a, b)
  const scale = normFrom > 0 && mag > 0 ? mag / normFrom : 1

  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const rfx = scale * (cos * fx - sin * fy)
  const rfy = scale * (sin * fx + cos * fy)
  return { scale, rotation, translate: [tx - rfx, ty - rfy] }
}

/** RMS residual |T(from_i) - to_i| for T = fitSimilarity(from, to). */
export function procrustesResidual(from: readonly Point[], to: readonly Point[]): number {
  const t = fitSimilarity(from, to)
  const n = from.length
  let sum = 0
  for (let i = 0; i < n; i++) {
    const p = apply(t, from[i]!)
    const dx = p[0] - to[i]![0]
    const dy = p[1] - to[i]![1]
    sum += dx * dx + dy * dy
  }
  return Math.sqrt(sum / n)
}
