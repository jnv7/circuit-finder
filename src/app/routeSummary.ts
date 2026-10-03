// Plain-language summary of a stored route's real deviation numbers, shown in the
// routes page's picker for every alternative at once (Phase 25) — not just the
// selected one, so the closest alternative is visible even when every stored
// route misses the bar. Pure; same rounding as the details panel's own figures.
import type { RouteEntry } from '../routes'

type Metrics = RouteEntry['metrics']

export function pickerSummaryLine(m: Metrics): string {
  return `${Math.round(m.meanDeviationM)} m on average, ${Math.round(m.maxDeviationM)} m at most · ${m.lengthRatio.toFixed(2)}× the circuit's length`
}
