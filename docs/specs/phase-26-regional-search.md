# Spec — Phase 26: Regional search (metropolitan-area concelhos, selectable by checkbox)

Status: `in progress` (2026-10-04 — Decisions A/B/C resolved, built, and
verified against a completed 6-circuit × 5-region regeneration; region
boundaries then revised the same day to 6 regions, official in
`src/regions.ts` but not yet regenerated — see "Boundaries revised,
2026-10-04 (later the same day)" below and the ROADMAP decision log)
Depends on: [phase-22-route-generator.md](phase-22-route-generator.md) (the generator
this phase re-runs per region), [phase-24-find-route-by-name.md](phase-24-find-route-by-name.md)
(the extraction pipeline this phase extends to new areas), [phase-25-routes-page-primary.md](phase-25-routes-page-primary.md)
(the picker this phase adds filtering to)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Today every generated route is searched against one fixed area: Porto's own street
mesh (`src/data/porto-streets.json`, bbox ≈ 50 km²). This phase searches each
circuit against **five independent areas** — Porto plus the concelhos of Vila do
Conde, Matosinhos, Vila Nova de Gaia, and Espinho — and lets the routes page
filter which areas' results count, by checkbox. Selecting every area shows the 3
best routes across the whole metro region; selecting only Gaia and Espinho shows
the 3 best south of the Douro only.

**Scope decision, 2026-10-03 (user call)**: Maia and Gondomar are dropped from
this phase — not rejected, just deferred, revisited later if there's a real
reason to want them. They were the two worst-case regions in the real-bbox
measurement below (Maia 2.33×, Gondomar 2.99× their official polygon area), so
dropping them also meaningfully improves the cost estimate: **≈15× today's
search area across the remaining 5 regions, not ≈27× across 7.** Everything
below that still names Maia/Gondomar is the pre-narrowing analysis, kept for the
record and for whenever those two get picked back up — treat the 5-region total
in each table as the number that actually governs this phase now.

The manual drag/rotate tool (`manual.html`) is explicitly **not** touched — it
stays exactly as it is today, scoped to Porto only, per the user's own framing of
this phase ("manual está bem, é só mapa do Porto, está fechado").

## How it stays true to the vision

- **"Judgement stays with the user."** The checkboxes are a user-driven filter over
  already-generated, already-honest results — not a new automated ranking.
- **Static and free, no backend.** Each region's street network is still a bundled
  static asset consumed only by the dev-only generator (Node), never fetched at
  runtime by either page. The routes page (`index.html`/`routesMain.ts`) already
  loads no street data at all (see the 2026-10-03 investigation in the ROADMAP
  decision log) — region count does not change that.
- **A route that misses the bar is stored anyway.** Unchanged; this phase adds
  *where* a route is from, not whether it's hidden.

## Why this is feasible without touching the search algorithm

`scripts/lib/generate.ts` already derives everything region-specific from the
loaded network at run time — `loadStreetNetwork()`'s own `bbox`, projected through
`portoProjection()`, becomes `poseSearch`'s `bounds`; `buildOrientationLayers` and
`buildStreetGraph` are built fresh from whatever `ways` were loaded. Nothing in
`src/route/` (`raster.ts`, `poseSearch.ts`, `escalate.ts`, `mapMatch.ts`,
`pruneSpikes.ts`, `metrics.ts`) hard-codes Porto. Searching a new region is
mechanically "load a different street-network file, run the same pipeline" — the
real work is **getting that data** and **orchestrating five runs instead of one**,
not changing the search.

## Estimated generation load vs. today

**Updated 2026-10-03 with real measurements** (first version of this section was
an area-ratio guess from official concelho areas; superseded by the figures below,
gathered during this same session — real Overpass bbox queries and one real
generator run, not simulated):

**Finding 1 — real admin-boundary bboxes, fetched from Overpass (`out bb` on each
concelho's `admin_level=7` relation), are far bigger than the official-area
guess assumed** — because these concelhos are elongated/irregular, not compact,
so their bounding rectangle covers much more than their polygon area:

| Area | Official km² | Real bbox km² (fetched) | bbox / official | In scope? |
| --- | --- | --- | --- | --- |
| Porto (today) | 41.7 | 50.6 | 1.21× | yes |
| Vila do Conde | 149.0 | 249.3 | 1.67× | yes |
| Matosinhos | 62.4 | 126.7 | 2.03× | yes |
| Maia | 82.9 | 192.8 | 2.33× | **dropped 2026-10-03** |
| Gondomar | 133.4 | 398.9 | 2.99× | **dropped 2026-10-03** |
| Vila Nova de Gaia | 168.5 | 292.9 | 1.74× | yes |
| Espinho | 21.0 | 33.9 | 1.61× | yes |
| **5 in-scope regions, sum** | **443.6** | **753.4** | — | — |
| (all 7, for reference) | 658.9 | 1345.1 | — | — |

**≈ 14.9× today's search area for the 5 in-scope regions** (753.4 / 50.6) —
dropping precisely the two worst-inflated bboxes (Maia, Gondomar) brings this
back close to the original ~16× guess, without needing polygon clipping to do
it. The all-7 figure (≈ 26.6×) is kept above for context/if Maia and Gondomar
are picked back up later, but no longer the number this phase plans against.

Polygon clipping (vs. a padded bbox) is still worth doing eventually — Vila do
Conde and Vila Nova de Gaia are still 1.6-1.7× their official area, and the
bbox-overlap issue below doesn't care how many regions are in scope — but it is
no longer the thing standing between this phase and an acceptable budget.

**Also found**: several of these bboxes overlap — e.g. Vila Nova de Gaia's
`[-8.676, 41.009, -8.449, 41.147]` and Porto's own `[-8.688, 41.135, -8.575,
41.183]` share a sliver around `41.135-41.147`. A padded-bbox approach can fetch
and search the same real street twice under two different region ids. Polygon
clipping removes this too (a street is unambiguously inside at most one
concelho's real boundary).

**Finding 2 — one real generation run, same code path, same circuit, now all 5
in-scope regions** — built this session's `extract-region` CLI (new: `scripts/
extract-region.ts`, `src/extract/streetNetwork.ts`, a `buildRegionHighwayQuery`
in `src/extract/overpass.ts`) and fetched all 4 non-Porto regions' real street
networks for real. Then ran the unmodified Phase 22 pipeline (`escalate.ts`'s
`generateRoutesForCircuit`) against all 5, same circuit (hungaroring), same
machine, back to back:

| Region | bbox km² | ways | nodes | Load+graph+raster | Generation | Tier reached | Best route |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Porto | 50.6 | 26 994 | 37 656 | 6.4 s | 87.7 s | 0 | passes (20.9 m / 68.1 m) |
| Espinho | 33.9 | 3 404 | ~4 626 | 2.2 s | 52.0 s | 0 | passes (23.5 m / 81.2 m) |
| Vila do Conde | 249.3 | 16 489 | 23 856 | 16.1 s | 96.7 s | 0 | passes (23.4 m / 89.2 m) |
| Matosinhos | 126.7 | 35 330 | 47 834 | 14.4 s | 99.2 s | 0 | passes (28.7 m / 95.2 m) |
| Vila Nova de Gaia | 292.9 | 27 586 | 34 805 | 24.0 s | **1 516.6 s** | **2 (full escalation)** | **fails (31.9 m / 95.2 m)** |

Four of five regions behaved as the area-ratio model predicts: tier-0-only,
87-99 s of generation, roughly tracking bbox area (Vila do Conde's 249 km²
bbox and Matosinhos' unusually dense network — denser than Porto's own,
47 834 nodes, because its bbox swallows Porto's northern urban continuation —
both still landed in the same 90-100 s band as Porto). **Vila Nova de Gaia did
not**: hungaroring's shape simply doesn't fit there well, so the generator
correctly did what the escalation ladder is designed to do — try tier 1, then
the widest tier 2 (400 poses, 16 match candidates, 8 prune passes) — and still
came back with every candidate missing the bar. That correctness cost **25.3
minutes for one circuit against one region**, a single data point an order of
magnitude past every other cell in this table.

This is not a bug and not evidence against the area-ratio model (which only
ever described tier-0 cost) — it is the same escalation behaviour already
documented for Silverstone against Porto (1 498 s across 3 tiers, Phase 22's
own decision log). It does mean the clean "~14× tier-0 estimate" below is a
**floor, not a ceiling**: any circuit/region pairing that doesn't fit well pays
the full escalation cost in just that one region, independent of how small or
cheap the other 4 regions were. See Finding 3 below for why this matters for
scheduling, and the new mitigation it suggests.

Interesting aside, not load-bearing for the cost estimate: all three hungaroring
candidates passed the bar in Espinho (vs. only the best of 3 in Porto, and none
in Gaia) — concrete illustration of the feature's actual point: the same
circuit fits some corners of the metro area and not others.

**Finding 3 — escalation cost varies by circuit/region fit, not by region size,
and can dominate the whole run.** Gaia's bbox (292.9 km²) is only 16% bigger
than Vila do Conde's (249.3 km²), which stayed at tier 0. The 15× cost
difference between them came entirely from *fit*, not area. A future circuit
could just as easily escalate expensively in Espinho (today's cheapest region)
if its shape happens not to suit Espinho's street layout. **Mitigation to add
to this phase's scope, not deferred**: a per-region time/tier cap independent
of the other regions — e.g. let each region run its own escalation ladder
to completion (current behaviour, correct), but surface tier-2 escalations
prominently in the generator's own log/output (`RouteFile.generator
.escalationTier` already records this per file) so a maintainer notices a
15-region-minute outlier rather than treating total wall-clock time as evenly
spread. Capping *search effort* itself (stopping before tier 2) would silently
under-search a region that might have passed with more effort — not proposed
here; the fix is visibility, not giving up early.

**Putting findings 1-3 together, for the 5 in-scope regions**: using real
bboxes and this session's real timing across all 5, a *typical* circuit (no bad
escalation) costs **~13-15× today's single-region tier-0 cost** — close to the
original ~16× guess, since dropping Maia and Gondomar removed the two outliers
that blew the 7-region figure out to ~27×. A circuit with one poorly-fitting
region, as this real run found for Gaia, costs that plus whatever tier that one
region's escalation needed — up to ~25 minutes extra, observed, for a single
region alone.

In wall-clock terms, this is no longer a projection — it's the real number for
one circuit: **hungaroring against all 5 regions took 31.9 minutes total**
(Table in Finding 2), of which 27.8 minutes (87%) was Gaia's escalation alone;
the other 4 regions together took 4.1 minutes. That total already sits inside
today's existing 45-minute full-ladder budget (sized for 3 tiers on *one*
region) — but with much less headroom than the pre-measurement estimate
assumed, and purely because only one of five regions escalated. **A second
region escalating to tier 2 for the same circuit would blow past 45 minutes.**
Across the ~20 pending calendar circuits, assuming a similar one-region-escalates
rate, sequential total lands in the **low-to-mid single-digit hours** — still
far from the multi-day figure the 7-region version of this estimate produced,
but with real per-circuit variance (a circuit that fits everywhere stays under
5 minutes; one that fits nowhere well could approach an hour by itself).

**This is a materially more tractable number than the original 7-region
estimate, and now a measured one rather than a projection for a typical
circuit — but Finding 3's per-region escalation variance means "typical" is
doing real work in that sentence.** The mitigations below are still worth
doing; Finding 3's visibility mitigation (surface tier-2 escalations per
region, don't bury them in a total) is now added to that list, not optional.

### Mitigations (part of this phase's scope, not deferred)

1. **Cache rasterised orientation layers per region on disk** (gitignored, like
   `find-route`'s `.cache/`), keyed by region id + a hash of that region's street
   file. Built once, reused by every circuit's generation run against that region.
2. **Parallelise across regions.** Each region's search is fully independent of
   every other region's — `generate-route`/`find-route` can fan out one child
   process per region (or per circuit × region) instead of a sequential loop,
   trading CPU-seconds (roughly unchanged) for wall-clock time (divided by however
   many cores are free).
3. **Surface per-region escalation prominently (Finding 3, real, not
   hypothetical).** `RouteFile.generator.escalationTier` already records which
   tier a region needed; the generator CLI's own per-circuit log should print
   each region's tier and wall-clock time as it finishes, not just a final
   total — so a maintainer running the 5-region batch sees immediately that
   (say) Gaia is the one eating 25 minutes, rather than wondering why one
   circuit took 32 minutes and another took 4.
4. **Open question, not a commitment**: whether a sparser anchor grid for the
   larger, likely-lower-yield concelhos (Vila do Conde, Espinho) is worth the risk
   of missing a real loop there — flagged below, not decided here. Finding 3
   suggests this wouldn't have helped Gaia anyway (its cost was tier escalation,
   not tier-0 search volume), so this stays low-priority.

## Decisions resolved, 2026-10-04

Picking up "Next steps" item 2 onward. The three decisions still open at the
end of the previous session are now resolved and built, each the option this
spec was already leaning towards:

- **Decision A (bbox vs. admin-polygon): kept the padded bbox.** Real street
  data for the 4 non-Porto regions is now fetched and committed
  (`src/data/regions/<id>-streets.json`, via `extract-region` against each
  concelho's real `admin_level=7` bbox — way counts match this spec's own
  Finding 2 table exactly: Vila do Conde 16 489, Matosinhos 35 330, Vila Nova
  de Gaia 27 586, Espinho 3 404). Polygon clipping stays deferred, same
  treatment as Maia/Gondomar — revisitable, not a blocker.
- **Decision B (file layout): one `RouteFile` per circuit, up to 15 routes.**
  `RouteEntry.area` (never actually populated by any committed file) is
  replaced by a required `region: RegionId`; `schemaVersion` bumps to `2`
  (breaking change — every file gets regenerated, so no v1 file needs to keep
  loading). `RouteFile.generator` keeps only `bar`; a new `regions: {id,
  poses, escalationTier}[]` records each searched region's own effort — this
  is also Finding 3's visibility mitigation, built. See `src/routes.ts` and
  `src/data/routes.schema.md`.
- **Decision C (orchestration): `--region <id>` flag, repeatable, default
  all 5.** `scripts/lib/generate.ts`'s `generateAndWriteRoute` now loops over
  regions (`scripts/lib/regionNetworks.ts`'s `loadRegionStreetNetwork`,
  dev-only, never bundled); `generate-route`/`find-route` both take the flag.
  A new `src/regions.ts` is the lightweight (no street data) region registry
  shared by the generator and the browser-bundled routes page.
- **Decision E/F (routes page UI): built.** `src/app/routesPage.ts` gained
  the region checkbox row (all checked by default), re-filters/re-ranks the
  picker to the best 3 among checked regions on every change
  (`app/routeSummary.ts`'s new `pickTopRoutes`), shows each route's region in
  the detail panel, and draws a dashed/unfilled rectangle per checked region
  as the lowest map layer. The URL hash grew a region segment
  (`#circuit/region/rank`, `app/routesHash.ts`) since rank alone is no longer
  unique once every region has its own rank 1. Region-selection itself is
  intentionally not part of the hash (an explicit scope call, not an
  oversight) — only the selected route stays bookmarkable, as before.

The real 6-circuit × 5-region regeneration (Next steps item 6) **completed**
the same day — 528/528 tests pass against the real multi-region data, two
real bugs it surfaced were fixed (see the ROADMAP decision log, 2026-10-04),
and the routes page was driven in a real browser to confirm the region
checkboxes and map rectangles work. See "Boundaries revised, 2026-10-04
(later)" below for what happened immediately after — this 5-region
generation's own code and results stand, only the boundaries moved next.

## Boundaries revised, 2026-10-04 (later the same day)

A user review of the regions **on an actual map** (not the schematic this
spec's own figures were reasoned from) found the padded admin bboxes
reaching well past anywhere a route could plausibly read as "near Porto" —
e.g. Vila do Conde's box reaching toward Esposende, Vila Nova de Gaia's
reaching inland past Valongo/Gondomar territory. Resolved, in order:

1. Vila do Conde and Vila Nova de Gaia's inland/non-coastal edges pulled in
   to meet Porto's own (frozen) box, instead of running to the full
   admin-boundary extent.
2. Vila do Conde's coastal (west) edge checked against the real street data
   already fetched and tightened by ~600 m of pure open water it didn't
   need — the other three coastal regions were already tight (within
   1-3 m of the real westmost street), confirming this was specific to Vila
   do Conde's north-edge trim moving its relevant westmost point out of the
   kept area, not a general problem with the bbox approach.
3. **Póvoa de Varzim added as a 6th region**, its own small
   (~22 km², hand-set) box around its built-up core — not folded into Vila
   do Conde's box and not left out, since the two towns' centres are only
   2.8 km apart (the user's call, after discussing a 5 km inter-region
   buffer and finding it would have made the two boxes nearly redundant at
   that distance).
4. Every inter-region boundary **in latitude** widened to a uniform 3 km
   overlap — calibrated against the largest bundled circuit's real
   bounding-box diagonal (baku-city, 2.55 km; the full set measured
   1.50-2.55 km), so a loop anchored near a shared edge still fits entirely
   inside whichever region's search actually finds it. Longitude overlap
   between neighbours was explicitly left alone (the user's framing:
   "inevitável" — every coastal region spans roughly the same east-west
   strip hugging the Atlantic, so overlap there isn't where a loop could be
   lost at a cut; only latitude is where regions actually sit edge to edge).
   This 3 km rule forced two edges neither side "owns" to move, since
   Porto's own box is frozen: Matosinhos' south edge (41.171°N → 41.156°N)
   and Vila Nova de Gaia's north edge (41.147°N → 41.162°N).

**These are now the official boundaries, committed in `src/regions.ts`** —
see its own header comment for the exact figures and reasoning, kept in
sync with this section. **Explicitly not regenerated in this pass** (the
user's own call — "não vamos gerar nada para estes circuitos, ficam como
estão"): `src/data/regions/*.json` and every committed
`src/data/routes/*.json` still reflect the *previous* boundaries, and Póvoa
de Varzim has no street file at all yet. `generate-route`/`find-route`
default to every id in `src/regions.ts`, so running either without
`--region` now fails loudly on Póvoa (`ENOENT` on its missing street file)
until that data is fetched — accepted deliberately (fail loudly beats a
silently wrong result), not yet fixed. The routes page itself needed no
code change for this revision (`REGIONS` is iterated, not length-checked
anywhere) — verified by running the full suite (still 528/528) and by
driving the real page in a browser: 6 checkboxes render, all default
checked, and the map rectangle count tracks checkbox state exactly.

## Decisions to make before implementation

*(Historical — the three decisions above are now resolved; this section is
kept for the reasoning that led to each choice.)*

**A. Where the new street data comes from — now partly built and validated**

- **Built this session, committed**: `src/extract/overpass.ts` gained
  `buildRegionHighwayQuery(bbox)` (same runnable-highway filter
  `porto-streets.json` was built with); `src/extract/streetNetwork.ts` is a new
  pure module (`buildStreetNetworkFile`, `clipToBbox`, `quantiseAndEncode`) that
  clips/simplifies/quantises/delta-encodes raw Overpass ways into exactly
  `porto-streets.json`'s own schema; `scripts/extract-region.ts` is a new CLI,
  `npm run extract-region -- <regionId> --bbox w,s,e,n`, reusing
  `http.ts`'s retry/mirror-endpoint fetch as-is. All three have tests.
  `src/streets.ts`'s `loadStreetNetwork` now takes optional `(data, project)`
  arguments (defaults unchanged) so it reads any region's file, not only
  Porto's.
- **Real run, not yet committed as bundled data**: `extract-region` fetched
  Espinho's real network for real (3 404 ways, 243.5 KB) — written to this
  session's scratchpad, not `src/data/regions/`, since decisions B and C below
  (ids, file layout) aren't locked and the bbox-vs-polygon choice right below
  isn't either; committing data under an unsettled shape would need redoing.
- **Softened back to a real choice, not a forced one, now that Maia/Gondomar are
  out of scope**: with the 5-region estimate at ~13-15× (close to the original
  guess) rather than ~27×, a padded bbox is no longer *necessary* to make this
  phase's cost acceptable — it's still the simpler option, and still what
  `buildRegionHighwayQuery`/`extract-region` already do today. Polygon clipping
  (fetching by the OSM admin-boundary relation's actual shape, via Overpass's
  `area`-derived-from-relation filter instead of a bbox) remains worth doing for
  correctness (a loop "in Gondomar" — if it returns — should mean inside
  Gondomar's real shape) and to remove the Porto/Gaia bbox overlap noted below,
  but it's a quality improvement now, not a blocker. Not yet built either way.

**B. Region ids and the route file schema**

- Fixed, stable ids for the 5 in-scope regions: `porto`, `vila-do-conde`,
  `matosinhos`, `vila-nova-de-gaia`, `espinho`. `maia` and `gondomar` are
  deliberately not allocated ids yet — adding them later is additive (new
  region files, no schema change), not a migration.
- `RouteFile`'s `routes[].area` is currently optional free text and **not
  actually populated** by today's generator. This phase replaces it with a
  required, machine-readable `region: string` (one of the fixed ids above) — a
  breaking schema change to `src/routes.ts`/`routes.schema.md`, requiring every
  existing committed route file to be regenerated (they're all Porto-only today,
  so they'd all get `region: "porto"`).
- Decide: one `RouteFile` per `<circuitId>`, now holding up to 3 routes **per
  region** (so up to 15 routes for a circuit searched everywhere), or one file per
  `<circuitId>-<regionId>`. Leaning towards the former (keeps "one file per
  circuit" simple for the existing lazy-loading scheme in `routesMain.ts`), but
  concatenating 5 regions' worth of `points` arrays raises the per-circuit file
  size proportionally — worth checking against actual output before committing.

**C. Orchestration**

- `scripts/lib/generate.ts`'s `generateAndWriteRoute` currently always calls
  `loadStreetNetwork()` (the one bundled Porto file). It needs a `regionId`
  parameter (or to run once per region internally) and a way to load any of the
  5 region files by id.
- `npm run generate-route -- <circuitId>` either grows a `--region <id>` flag (run
  one region at a time, composable with a shell loop) or runs all 5 regions by
  default in one invocation (simpler for the maintainer, and now a ~20-25 minute
  tier-0 cost per the revised estimate, not the old 7-region worst case). Leaning
  towards `--region`, default to all 5 if omitted, so a single slow region can
  still be re-run alone when needed.

**D. Projection distortion over the wider extent — resolved, built this session**

- `src/porto.ts`'s `portoProjection()` is a single equirectangular projection
  about a fixed Porto-centred origin, documented as "< 0.3 % distortion over the
  bundled street bbox" (≈ 7 km radius from origin). Vila do Conde sits ≈ 25 km
  away; Gondomar/Gaia/Espinho likewise tens of km out, so sharing that fixed
  origin was never going to be acceptable at full metro-area scale.
- Resolved in favour of the "give each region its own origin" option:
  `src/geo.ts` gained `bboxCenterProjection(bbox)`, and `src/streets.ts`'s
  `loadStreetNetwork(data, project)` now takes that projection as a parameter
  (default unchanged: Porto's own data + `portoProjection()`). The Espinho timing
  run above (Finding 2) used exactly this — `bboxCenterProjection(espinho.bbox)`
  — proving the plumbing end to end. Each region is internally consistent with
  itself; a route's stored `pose`/`points` are plain lon/lat regardless, so this
  was purely an internal accuracy fix, never a schema change.
- Still open: `scripts/lib/generate.ts`'s `generateAndWriteRoute` itself hasn't
  been wired to take a region/projection parameter yet — today it still always
  calls bare `loadStreetNetwork()` (Porto only). That's Decision C below.

**E. Routes page UI**

- `src/app/routesPage.ts` gains a checkbox row (one per region, all checked by
  default — "whole metro area"). Changing the selection re-filters the loaded
  route file's entries by `region` and re-picks the top 3 by existing rank/
  `worstRatio` ordering among the selected subset, reusing `renderPicker` as-is
  once it's handed the filtered list.
- Each route's region should be visible in the picker/detail view (e.g. "Espinho"
  next to the existing area free-text line), so a user picking "everywhere" still
  knows where a given alternative actually is.

**F. Non-intrusive selected-area map indicator (user request, 2026-10-03)**

- Checking/unchecking a region should be visible on the map itself, not only in
  the checkbox list — but "non-intrusive": it must not compete with the route
  polyline, which stays the page's one real subject.
- **Approved by the user, 2026-10-03.** Prototyped as a standalone artifact this
  session using this session's real fetched bboxes for all 7 regions (built
  before the Maia/Gondomar scope cut above — the real app build only needs
  checkboxes/outlines for the 5 in-scope ones; dropping two rows is trivial
  whenever this gets wired in for real). Design: each selected region draws as a
  **thin dashed outline only — no fill, or fill-opacity ≈ 0.03** — on a Leaflet
  `L.rectangle` (the region's bbox) or `L.polygon` (if Decision A lands on the
  real admin polygon instead), in a muted neutral stroke, added as the
  lowest-z map layer so the route polyline and street tiles always read on
  top. Unchecking removes it immediately; nothing animates in a way that
  competes for attention. No per-region colour-coding beyond the one neutral
  stroke — colouring seven regions distinctly was tried in the prototype and
  read as busier/more intrusive than useful, since at most one or two
  checkboxes are expected to change at a time and the picker's own route list
  already says which region each alternative is in (point directly above).
- Depends on Decision A (bbox vs. polygon) for *what* geometry gets drawn, but
  not on B/C (schema/orchestration) — the outline only needs each region's
  boundary, not its generated routes, so this piece could in principle be
  built before the rest of the phase, once A is settled.

## Not in scope

- Any change to `manual.html`, `src/app/map.ts`, or `src/data/porto-streets.json`
  — the manual tool stays Porto-only, exactly as today.
- Any change to the search algorithm itself (`raster.ts`, `poseSearch.ts`,
  `escalate.ts`, `mapMatch.ts`, `pruneSpikes.ts`, `metrics.ts`) beyond being
  invoked once per region instead of once total.
- Regenerating every bundled/committed route file for every region in this spec
  — that's the implementation's own execution, not a design decision.
- A composite cross-region "match score" — each region's routes are judged by the
  same existing bar, nothing new is computed to compare regions against each other.

## Next steps (agreed order, 2026-10-03)

1. ~~**Fetch real street data for Vila do Conde, Matosinhos, and Vila Nova de
   Gaia**~~ **Done, same day.** All 4 non-Porto regions now have real fetched
   street data (Vila do Conde 16 489 ways, Matosinhos 35 330 ways, Vila Nova de
   Gaia 27 586 ways — Espinho already done) and a real generation run against
   all 5 for hungaroring: see Findings 2-3 above. Headline result: total 31.9
   minutes, not the ~20-25 minute projection — Vila Nova de Gaia needed full
   tier-2 escalation and still missed the bar for this circuit, costing 25.3 of
   those 31.9 minutes by itself. The ≈13-15× figure holds for the *typical* case
   (4 of 5 regions matched it almost exactly); escalation variance is real and
   now has a mitigation (#3 above) rather than being hypothetical.
2. ~~**Decide bbox vs. admin-polygon** for the Overpass query (Decision A)~~
   **Done, 2026-10-04**: kept the bbox; polygon clipping deferred (see
   "Decisions resolved" above).
3. ~~**Schema**: add `RouteFile.routes[].region`...~~ **Done, 2026-10-04**:
   one file per circuit, `schemaVersion: 2`, `region` required, `regions[]`
   added. `src/routes.ts`, `src/data/routes.schema.md`.
4. ~~**Orchestration**: `--region` flag...~~ **Done, 2026-10-04**:
   `scripts/lib/generate.ts`/`generate-route.ts`/`find-route.ts`,
   `scripts/lib/regionNetworks.ts`, `src/regions.ts`.
5. ~~**Routes page UI**: real checkboxes...~~ **Done, 2026-10-04**:
   `src/app/routesPage.ts`, `src/app/routeSummary.ts`'s `pickTopRoutes`,
   `src/app/routesHash.ts`'s 3-segment hash, `src/style.css`. `map.ts` stayed
   untouched as planned — the region rectangles live in the routes page's own
   inline map, not the manual tool's.
6. ~~**Run the full 6-circuits × 5-regions generation**~~ **Done, 2026-10-04**:
   completed, full suite verified against the real data (528/528), two real
   bugs found and fixed, routes page driven in a real browser. See
   "Boundaries revised, 2026-10-04 (later the same day)" above — the
   regions searched here are the *previous* boundaries, superseded shortly
   after by the same-day revision.
7. **Fetch real street data for the revised Vila do Conde / Matosinhos /
   Vila Nova de Gaia boxes and the new Póvoa de Varzim box**, then
   regenerate the 6 bundled circuits against the revised 6-region set (or
   merge just the changed regions into the existing files — undecided which
   is cheaper, since Porto's own escalation cost varies hugely by circuit
   and isn't itself being redone). Not started.
8. Reassess the full F1 calendar batch against the real per-circuit cost,
   once step 7 lands.

Mirrored in [../ROADMAP.md](../ROADMAP.md)'s "Current priority" — keep both in
sync if this list changes.

## Open questions

- **Resolved**: scope is 5 regions (Porto, Vila do Conde, Matosinhos, Vila Nova
  de Gaia, Espinho) — Maia and Gondomar deliberately dropped, 2026-10-03, user
  call, revisitable later. Projection origin (D) — resolved, per-region, built
  and used this session. The non-intrusive map-indicator design (F) — approved
  by the user, 2026-10-03; prototype at the artifact link in that session's
  reply, not yet built into the real app. All 5 regions' real street networks
  are now fetched and one real 5-region generation run is measured (Findings
  2-3) — the estimate is no longer a projection for the typical case, though
  per-circuit escalation variance (Finding 3) means any individual circuit can
  still cost much more than that typical case.
- **Resolved, 2026-10-04**: bbox vs. admin-polygon (A) — kept bbox, deferred
  polygon clipping; one file per circuit vs. per circuit-region (B) — one file
  per circuit; `--region` flag granularity (C) — repeatable flag, default all
  5. See "Decisions resolved" above.
- Whether a sparser anchor grid for low-yield concelhos is worth the risk to
  recall — not decided, flagged only; Finding 3 suggests it's the wrong lever
  anyway (Gaia's cost was escalation, not search volume at a given tier).
- New from Finding 3: should a region's escalation ever be time-boxed (e.g.
  abort tier 2 after N minutes) rather than always running to completion? Not
  proposed as a default — it would trade a slower, correct search for a faster,
  possibly-wrong one — but worth a decision if a future circuit's escalation
  runs far longer than Gaia's 25 minutes.
