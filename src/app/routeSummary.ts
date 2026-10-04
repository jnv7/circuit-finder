// Plain-language summary of a stored route's real deviation numbers, shown in the
// routes page's picker for every alternative at once (Phase 25) — not just the
// selected one, so the closest alternative is visible even when every stored
// route misses the bar. Pure; same rounding as the details panel's own figures.
import type { RegionId } from '../regions'
import type { RouteEntry, RouteFile } from '../routes'

type Metrics = RouteEntry['metrics']
type Bar = RouteFile['generator']['bar']

export function pickerSummaryLine(m: Metrics): string {
  return `${Math.round(m.meanDeviationM)} m on average, ${Math.round(m.maxDeviationM)} m at most · ${m.lengthRatio.toFixed(2)}× the circuit's length`
}

/** Same ranking formula as `route/metrics.ts`'s `worstRatio` (the worst of
 *  the four bar terms — `<= 1` iff every term is within the bar), duplicated
 *  rather than imported so the routes page never bundles the generator's
 *  graph/raster machinery (same reasoning as `barMisses.ts`'s own duck-typed
 *  `Bar`). Lower is better; used only to rank, never shown. */
function worstRatio(m: Metrics, bar: Bar): number {
  const meanRatio = m.meanDeviationM / bar.meanM
  const maxRatio = m.maxDeviationM / bar.maxM
  const retraceRatio = m.retracedFraction / bar.retrace
  let lengthTerm = 0
  if (m.lengthRatio < bar.ratioLo) lengthTerm = 1 + (bar.ratioLo - m.lengthRatio) / bar.ratioLo
  else if (m.lengthRatio > bar.ratioHi) lengthTerm = 1 + (m.lengthRatio - bar.ratioHi) / bar.ratioHi
  return Math.max(meanRatio, maxRatio, lengthTerm, retraceRatio)
}

/** Filter `routes` to the selected regions, then take the best `n` (lowest
 *  `worstRatio` first) — Phase 26: "selecting every area shows the 3 best
 *  routes across the whole metro region; selecting only Gaia and Espinho
 *  shows the 3 best south of the Douro only." */
export function pickTopRoutes(
  routes: readonly RouteEntry[],
  selected: ReadonlySet<RegionId>,
  bar: Bar,
  n = 3,
): RouteEntry[] {
  return routes
    .filter((r) => selected.has(r.region))
    .slice()
    .sort((a, b) => worstRatio(a.metrics, bar) - worstRatio(b.metrics, bar))
    .slice(0, n)
}
