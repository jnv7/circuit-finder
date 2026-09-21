// Plain wording for *how* a stored route misses the acceptance bar, so a route
// that fails is shown honestly with its real figures and the limit it crossed
// (Phase 23). Pure. The bar is read literally: every term inside its stated
// limit, the length ratio inside `[ratioLo, ratioHi]`. That matches
// `route/metrics.ts`'s `passesBar` everywhere except one Phase 22 defect (its
// length term is normalised by the boundary it crossed, so a route up to 2.4×
// the circuit's length "passes") — see the ROADMAP decision log, 2026-09-21.
// Only types are imported, so the routes page does not bundle the generator.
import type { RouteEntry, RouteFile } from '../routes'

type Metrics = RouteEntry['metrics']
type Bar = RouteFile['generator']['bar']

/** Whole numbers, unless rounding would make a figure and its limit look
 *  equal ("30 m, limit 30 m") — then one decimal, so a miss never reads as a tie. */
function metres(value: number, limit: number): string {
  const decimals = Math.round(value) === Math.round(limit) ? 1 : 0
  return `${value.toFixed(decimals)} m`
}

/** Two decimals, unless the figure would round onto the limit it crosses. */
function times(ratio: number, limit: number): string {
  const decimals = ratio.toFixed(2) === limit.toFixed(2) ? 3 : 2
  return `${ratio.toFixed(decimals)}×`
}

function percent(fraction: number, limit: number): string {
  const decimals = Math.round(fraction * 100) === Math.round(limit * 100) ? 1 : 0
  return `${(fraction * 100).toFixed(decimals)} %`
}

/** One sentence per bar term the route misses, in a stable order (mean,
 *  longest deviation, length, retracing); `[]` when the bar is met. */
export function barMisses(m: Metrics, bar: Bar): string[] {
  const misses: string[] = []
  if (m.meanDeviationM > bar.meanM) {
    misses.push(`mean ${metres(m.meanDeviationM, bar.meanM)}, limit ${bar.meanM} m`)
  }
  if (m.maxDeviationM > bar.maxM) {
    misses.push(`longest deviation ${metres(m.maxDeviationM, bar.maxM)}, limit ${bar.maxM} m`)
  }
  if (m.lengthRatio < bar.ratioLo || m.lengthRatio > bar.ratioHi) {
    const crossed = m.lengthRatio < bar.ratioLo ? bar.ratioLo : bar.ratioHi
    misses.push(
      `length ${times(m.lengthRatio, crossed)} the circuit, allowed ${bar.ratioLo.toFixed(2)}× to ${bar.ratioHi.toFixed(2)}×`,
    )
  }
  if (m.retracedFraction > bar.retrace) {
    misses.push(`retraces ${percent(m.retracedFraction, bar.retrace)} of its length, limit ${Math.round(bar.retrace * 1000) / 10} %`)
  }
  return misses
}
