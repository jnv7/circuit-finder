// Phase 26: the fixed set of metro-area regions a circuit is searched
// against. Deliberately lightweight — no street data, so this module is safe
// to import from the browser-bundled routes page (`app/routesPage.ts`) as
// well as the dev-only generator (`scripts/lib/`); each region's full street
// network lives only in `src/data/regions/<id>-streets.json` (Porto's own,
// Phase 3's original asset, lives there too — 2026-10-04, moved for
// directory consistency with the regions this phase added, no content
// change), loaded only by the generator, never fetched or bundled at
// runtime by either page except Porto's, which `src/app/map.ts`'s manual
// tool also bundles directly (via `src/streets.ts`'s default import) since
// it predates this phase. Maia and
// Gondomar are deliberately not allocated ids yet (see
// docs/specs/phase-26-regional-search.md) — adding them later only grows
// `REGIONS`, no existing id changes.
//
// 2026-10-04: boundaries revised from the first real-fetched admin bboxes,
// and Póvoa de Varzim added, after a map-based review found the originals
// reaching well past anywhere a route could plausibly read as "near Porto"
// (see the ROADMAP decision log, 2026-10-04, for the full reasoning —
// coastal/excluded edges tightened to the real westmost street already
// fetched; inter-region edges in *latitude* widened to a uniform 3 km
// overlap, calibrated against the largest bundled circuit's own 2.55 km
// footprint, so a loop anchored near a shared edge still fits inside
// whichever region's search finds it; longitude overlap is left alone —
// inevitable among regions hugging the same coastline, not a loop-loss risk).
// These are now the *official* boundaries, but data hasn't caught up yet:
// `src/data/regions/*.json` and every committed `src/data/routes/*.json`
// still reflect the *previous* boundaries (Póvoa has no street file at all).
// Running `generate-route` without `--region` will fail loudly on
// Póvoa until its street data is fetched — deliberate (fail loudly beats a
// silent wrong result), not yet fixed; re-fetching + regenerating against
// these boundaries is a follow-up, not done in this pass.
import type { BBox } from './streets'

export type RegionId = 'povoa-de-varzim' | 'vila-do-conde' | 'matosinhos' | 'porto' | 'vila-nova-de-gaia' | 'espinho'

export type RegionMeta = {
  id: RegionId
  label: string
  /** `[west, south, east, north]`, decimal degrees. Porto's is
   *  `regions/porto-streets.json`'s own bbox (content untouched, out of
   *  scope this phase — only its directory moved).
   *  The others are hand-set (2026-10-04 revision, see the module comment)
   *  from real fetched reference points — not simply each concelho's own
   *  admin-boundary bbox any more. Used by the routes page's map indicator;
   *  the generator takes its actual search bounds from whatever street file
   *  it loads, so this and that file can drift until both are refreshed
   *  together. */
  bbox: BBox
}

// North to south along the coast.
export const REGIONS: readonly RegionMeta[] = [
  { id: 'povoa-de-varzim', label: 'Póvoa de Varzim', bbox: [-8.775, 41.353, -8.725, 41.4] },
  { id: 'vila-do-conde', label: 'Vila do Conde', bbox: [-8.762, 41.2461147, -8.688, 41.38] },
  { id: 'matosinhos', label: 'Matosinhos', bbox: [-8.7291578, 41.156, -8.5954479, 41.2731147] },
  { id: 'porto', label: 'Porto', bbox: [-8.688, 41.135, -8.575, 41.183] },
  { id: 'vila-nova-de-gaia', label: 'Vila Nova de Gaia', bbox: [-8.676, 40.9987665, -8.58, 41.162] },
  { id: 'espinho', label: 'Espinho', bbox: [-8.6531193, 40.9647783, -8.5936229, 41.0257665] },
] as const

export const REGION_IDS: readonly RegionId[] = REGIONS.map((r) => r.id)

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === 'string' && (REGION_IDS as readonly string[]).includes(value)
}

export function regionLabel(id: RegionId): string {
  return REGIONS.find((r) => r.id === id)?.label ?? id
}
