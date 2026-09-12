# Roadmap

Living document: phases, current priority, decisions, open questions, and future
ideas. See [VISION.md](VISION.md) for the product goal and
[../CONVENTIONS.md](../CONVENTIONS.md) for engineering rules.

## Current priority

**Two specs written, neither implemented yet.** Real use of Phase 10 surfaced
two separate, independent quality problems with suggestions on Porto's real
data, prompted by a user-reported concrete case (a 4.67 km circuit whose
best-effort suggestion came back as a 10.02 km loop with visible "there and
back" jogs, all clustered in one small part of the city):

- [specs/phase-11-straighten-best-effort-loops.md](specs/phase-11-straighten-best-effort-loops.md)
  — best-effort loops snap each sample to the nearest street point blind to
  direction, so a sample can jog onto a misaligned side street or driveway
  and back. Fix: snap only to streets running the same way the circuit does
  there (direction-aware search, reusing Phase 6's own alignment test).
- [specs/phase-12-anchor-on-real-streets.md](specs/phase-12-anchor-on-real-streets.md)
  — resolves the 2026-09-11 open question below: suggestions cluster in one
  part of the bbox because the coarse grid sweep only ever proposes candidates
  from a blind grid, and dedup doesn't encourage spread. Fix: also seed
  candidates from real streets whose own longest straight matches the
  circuit's, plus an explicit diversity pass in final selection.

These are separate levers (loop construction quality vs. candidate placement)
and can ship in either order or independently. Neither has a locked
implementation order yet — that's the next decision.

Still true from Phase 10: `routedCount` (fully-connected loops) stays 0 for
all three bundled circuits — `MAX_LENGTH_RATIO` still blocks that path,
unchanged by either new spec. Full story: the Phase 10 decision-log entry
below and
[specs/phase-10-best-effort-routed-loops.md](specs/phase-10-best-effort-routed-loops.md).

## Phases

Status: `todo` / `in progress` / `done`.

### Phase 0 — Skeleton + CI — `done`

Spec: [specs/phase-0-skeleton.md](specs/phase-0-skeleton.md).

- Repo layout, `CONVENTIONS.md`, `CLAUDE.md`.
- Vite + TypeScript + Vitest set up, 9 passing tests.
- CI: test + build on push, deploy to Pages from `main` (originally
  `.gitlab-ci.yml`; moved to GitHub Actions on 2026-09-10 — see the decision
  log).
- Minimal page that loads `circuits.json` and lists the circuits.

### Phase 1 — Circuit data + geometry toolkit — `done`

Spec: [specs/phase-1-geometry.md](specs/phase-1-geometry.md).

- `circuits.json` full schema (`officialLengthM`, `attribution`, `[lon, lat]`
  `centreline`) + loader validation, including a projected-length cross-check.
- Three circuits normalised from OSM as closed centrelines: `hungaroring`,
  `silverstone`, `catalunya`. Data provenance in `src/data/circuits.schema.md`.
- `src/geo.ts` (equirectangular projection) and `src/geometry/` toolkit:
  `vector`, `path` (`pathLength`, `resample`, `centroid`, `signedArea`,
  `bounds`, `recenter`), `transform` (similarity, no reflection), `straight`
  (`longestStraight`).
- 48 passing tests, including `fast-check` property tests for
  rotate/scale invariance.

### Phase 2 — Map + acetate overlay — `done`

Spec: [specs/phase-2-map-overlay.md](specs/phase-2-map-overlay.md).

- Leaflet map, fixed initial view on Porto.
- Pick a circuit; render its centreline as an overlay at real-world scale
  (1:1 default, optional multiplier).
- Drag to move, handle to rotate. No mirror.
- Live readout: lap length and longest straight, in km/m.

### Phase 3 — Street proximity feedback — `done`

Spec: [specs/phase-3-street-proximity.md](specs/phase-3-street-proximity.md).

- Bundle a simplified Porto street network as a static asset (same pattern as
  `circuits.json`); no runtime Overpass.
- Spatial grid index built once on load; nearest-street distance per centreline
  point stays a pure, fast, offline computation.
- While the user moves/rotates the overlay, colour it on a green→amber→red
  ramp — ideally per segment — by how much of its length sits within ~10 m of a
  street. A hint, not a verdict; the user still judges the fit.
- No automatic placement or search (that stays Phase 6+).

### Phase 4 — Save & restore a placement — `done`

Spec: [specs/phase-4-save-restore-export.md](specs/phase-4-save-restore-export.md).

- Save the current placement (`circuitId` + Phase 2 `Placement` + `savedAt`) to
  `localStorage` under one key — **one saved placement per circuit**, keyed by
  `circuitId`.
- Auto-restore: opening the app, or picking a circuit, loads that circuit's
  saved placement (and pans to it) if one exists.
- Preview the saved placement against the live one before overwriting; revert to
  it; delete it. Save over an existing entry asks first.
- No attempt list, names, notes, examples, or file export/import (all Phase 6+).

### Phase 5 — Trace & study — `done`

Spec: [specs/phase-5-trace-and-study.md](specs/phase-5-trace-and-study.md).

- Trace mode: free clicking along real streets, following the overlay, to draw
  the route (straight segments between clicks; no snapping — that is Phase 6+).
  Add / undo / clear points; the overlay locks while tracing.
- Route stats: real length vs the circuit length at the current scale, and a
  symmetric mean/max **deviation in metres** — a description, not a match score.
- "Study view": a toggle that strips the UI to the map + route + a small summary
  for a clean screenshot (browser print works; a print stylesheet and PNG
  export are later).
- The route is persisted with its placement (`SavedPlacement` gains an optional
  `route`, `schemaVersion` → 2, v1 records still load).

### Phase 6 — Suggested placements — `done`

Spec: [specs/phase-6-suggested-placements.md](specs/phase-6-suggested-placements.md).

- Opt-in **Suggest placements**: coarse-to-fine search over translation +
  rotation (fixed scale) of the chosen circuit against the bundled Porto street
  index; objective = Phase 3 coverage + turning-function distance + Procrustes
  residual of the snapped samples.
- Show the best ~5 as ranked rows ("NN % on streets · ~NN m avg"); hover to
  preview the outline, **Use this** to drop the circuit there (still fully
  draggable, route cleared with a confirm).
- Time-sliced on the main thread (progress bar + cancel), no Web Worker, no
  Overpass, no routable graph.

### Phase 7 — Routable street graph & routed tracing — `done`

Spec: [specs/phase-7-street-graph.md](specs/phase-7-street-graph.md).

- A routable graph (`graph.ts`) built once, client-side, from the already-
  bundled street ways — junctions merged by tolerance, T-junctions split, no
  new data file or dependency.
- Trace mode snaps clicks to the network and joins consecutive waypoints by
  their real shortest path (A*) instead of a straight line; route length and
  deviation measure that real routed path.
- No loop-finding: the graph is not (yet) searched for a closed loop shaped
  like the circuit, and Phase 6's suggestions stay geometry-only. That stays a
  later item once this graph has proven itself.

### Phase 8 — Routed loop suggestions — `done`

Spec: [specs/phase-8-routed-loop-suggestions.md](specs/phase-8-routed-loop-suggestions.md).

- For each of Phase 6's geometry-ranked candidates, try to build a real,
  fully street-connected closed loop around its placed outline using Phase 7's
  graph — every sample must snap to the network and every consecutive pair
  (closing the loop) must actually connect; no silent straight-line patching.
- A validated **routed suggestion** is labelled with its real loop length and
  its deviation from the circuit shape in metres (`app/trace.ts`'s
  `routeStats`, reused) instead of a coverage percentage; using it seeds both
  the placement and an editable traced route that already follows streets.
- **Simple vs not.** A loop that only closes by retracing one of its own
  streets (`RoutedLoop.simple: false`) ranks below one that never repeats a
  metre of street — connected end to end isn't the same as a real closed
  loop.
- Falls back to Phase 6's old geometry-only suggestions when no candidate in
  the pool can form a full loop, so the list is never emptier than before.

### Phase 9 — Street graph connectivity repair (crossing detection) — `done`

Spec: [specs/phase-9-graph-connectivity-repair.md](specs/phase-9-graph-connectivity-repair.md).

- A third connectivity-repair pass in `graph.ts`: detects two ways crossing or
  passing within `CORRIDOR_M` (6m) of each other in their middle (not just at
  endpoints), splitting both there — real connected-component share on the
  bundled data: 88.3% → ~95.3%.
- A short hardcoded exclusion list (`GRADE_SEPARATED_EXCLUSIONS`) for known
  grade-separated crossings (the Douro bridges, a few viaducts) in the
  bundled bbox, so the 2D crossing test doesn't merge roads that only pass
  over/under each other.
- No change to `porto-streets.json` or its extraction pipeline — repair stays
  at graph-build time, same principle as Phase 7.
- **Did not** unlock a routed suggestion for any bundled circuit — connectivity
  was not, after all, the last blocker; see *Current priority* above and the
  decision log for the `MAX_LENGTH_RATIO` finding this phase surfaced.

### Phase 10 — Best-effort routed loops (mark the gaps, don't reject) — `done`

Spec: [specs/phase-10-best-effort-routed-loops.md](specs/phase-10-best-effort-routed-loops.md).

- A new suggestion kind that never fails: builds the loop leg by leg around a
  Phase 6 candidate, keeping every real routed street segment and drawing any
  leg the network can't connect as a straight line, flagged red, instead of
  discarding the whole candidate over one bad leg (Phase 8's behaviour).
- `app/trace.ts`'s `expandRoute` (already silently fell back to a straight
  line per leg for manual tracing) is now `expandRouteWithGaps`, reporting
  which legs those are — manual **Trace route** shows the same red gaps, not
  just new suggestion rows.
- Ranks between Phase 8's fully-routed loops and the old bare
  coverage-percentage fallback: real routed > best-effort (fewest invented
  metres wins) > coverage-only.
- No change to `MAX_LENGTH_RATIO`, `CORRIDOR_M`, or any other existing
  constant — adds a new outcome tier, does not retune the old ones.
- **Real-data result:** all three bundled circuits now return 5 best-effort
  suggestions each (previously 0 routed, all coverage-only fallback) —
  inventing 570–2200 m of "street" across 6–23 gap legs per suggestion.
  `routedCount` stays 0 for all three, unchanged from Phase 9 — see the
  decision log for what that implies for Phase 11.

### Later — not scheduled

- A saved-placement "repository": more than one saved attempt per circuit, with
  names, notes, and a list to load from (Phase 4 ships one per circuit only).
- File export/import of a saved placement — a self-identifying versioned JSON
  wrapper, import-as-copy — for hand-carrying a placement between machines
  (dropped from Phase 4).
- Free the map: any location, pan/zoom, place search.
- Street network beyond the bundled Porto box: either a larger bundled asset or
  an on-demand "load streets for this area" button that fetches Overpass for the
  current view and caches it. Needed before the map can be freed *and* before
  Phase 6's search can suggest placements outside Porto.
- A freeform, shape-first graph search (bending a loop street-by-street to fit
  the circuit, rather than validating poses Phase 6's rigid search already
  found) — a later item if Phase 8's simpler validate-what-Phase-6-found
  approach proves too limited on real Porto data.
- Editable circuit scale target by distance instead of 1:1 (composes with the
  Phase 6 search to add a scale degree of freedom).
- Matching a freehand sketch / the user's traced route against the network to
  find circuit-like loops (reuses the Phase 6 objective functions).
- More circuits; auto-select the circuit for the current race weekend.
- GPX export of the traced route.
- Cache Phase 6 search results (keyed by circuit + scale, and invalidated if
  either changes) so **Suggest placements** does not always recompute from
  scratch — clicking it again for the same circuit/scale would be instant.

## Decision log

Newest first. Each entry dated.

- **2026-09-12 — Phase 12 spec written: anchor candidates on real streets,
  add diversity to final selection.** Directly prompted by a user-reported
  case (see the Phase 11 entry below) plus the still-open 2026-09-11
  clustering question: Phase 6's coarse grid sweep proposes candidates purely
  by score, and dedup only removes near-duplicates, so a high-scoring
  neighbourhood can fill every slot. Decision: add a second seeding path —
  for every bundled street, find its own longest straight
  (`geometry/straight.ts`'s existing `longestStraight`, already used for the
  circuit's own readout), keep those within 60–160% of the circuit's longest
  straight's length, and seed a candidate (both directions along the street)
  placing the circuit's straight onto each match. These seeds merge into the
  same coarse pool the grid sweep fills, so they get the same refine/dedup
  treatment, not a separate code path. Final selection also gains a
  two-pass accept: fill slots preferring candidates at least 800 m from
  every already-accepted one, then fill any remaining slots by plain score —
  so a circuit with only one good spot in Porto still gets a full result set,
  never fewer than today. No change to the grid sweep, its constants, or
  Phase 8/10's routing on top of whatever candidates come out. Full spec:
  `docs/specs/phase-12-anchor-on-real-streets.md`.

- **2026-09-12 — Phase 11 spec written: snap best-effort samples by direction,
  not just distance.** Prompted by a user-reported concrete case: a 4.67 km
  circuit's best-effort suggestion came back as a 10.02 km loop with visible
  "there and back" jogs — not a data-coverage problem (deviation stayed
  modest) but a construction one. `tryRouteLoop`/`buildBestEffortLoop` snap
  each of `LOOP_SAMPLES` samples to the nearest street point independently,
  blind to which way that street runs, so a sample can jog onto a
  perpendicular side street or driveway and back. Decision: add
  `StreetGraph.nearestAlignedPointM`, mirroring `nearestPointM` but filtering
  by heading alignment the same way `StreetIndex.nearestAlignedM` (Phase 6's
  own candidate scoring) already does, and have both loop-construction
  functions snap through it instead, using each sample's own local heading
  (factored out of `objective.ts`'s `scoreCandidate`, not duplicated). A
  sample with no *aligned* street within `LOOP_SNAP_MAX_M` is treated as
  unresolved (a gap, or a rejected candidate for `tryRouteLoop`) rather than
  falling back to the nearest misaligned point — may raise some gap counts,
  an accepted honest trade. No change to `MAX_LENGTH_RATIO`, `LOOP_SAMPLES`,
  `LOOP_SNAP_MAX_M`, or manual tracing (unaffected — this only touches
  suggestion construction). Independent of and separable from Phase 12 (this
  is about loop quality once placed; Phase 12 is about where candidates come
  from). Full spec: `docs/specs/phase-11-straighten-best-effort-loops.md`.

- **2026-09-12 — Phase 10 shipped: every circuit gets a real best-effort
  suggestion.** `match/loopSearch.ts` gained `buildBestEffortLoop` — same
  inputs as `tryRouteLoop` (resample the placed outline, snap each sample,
  route each leg) but never returns `null`: a sample that doesn't resolve
  within `snapMaxM` keeps its raw placed point with no node, and any leg
  whose endpoints don't both resolve *and* connect becomes a straight `real:
  false` gap instead of failing the whole candidate. The join logic itself —
  "route by shortest path if both endpoints have a resolved node, else a
  straight line, flagged" — is one shared primitive (`app/trace.ts`'s new
  `joinWaypoints`), used both by the new suggestion path and by
  `expandRouteWithGaps`, which replaces `expandRoute` for manual tracing; the
  two callers differ only in how generously they resolve a point to a node
  (tracing reuses its existing 100 km "already a network point" tolerance,
  suggestions use the tight `LOOP_SNAP_MAX_M`). `searchRoutedLoops` slots
  best-effort in as a new tier between routed and fallback, filling
  `loopResultCount` slots from routed + best-effort combined — so the old
  bare coverage-percentage fallback is now reached only if the candidate pool
  itself runs out first, not on every non-routing candidate as before.
  Ranked by `gapLengthM` ascending (fewest invented metres wins), ties by
  `meanDeviationM`. `app/map.ts` renders real and gap legs as two Leaflet
  polylines (an unchanged style plus a new red dashed one, fed as a
  multi-segment array — `L.polyline([[…],[…]])` draws disjoint segments in
  one layer, no per-leg layer management needed) for both the drawn trace
  line and a hovered suggestion's preview; adopting a best-effort suggestion
  seeds `AppState.route` from its full point sequence exactly as a Phase 8
  loop does, so gap status is always recomputed from the current graph at
  render time, never persisted (same pattern Phase 3/7 already use).
  **Real-data result:** all three bundled circuits (`hungaroring`,
  `silverstone`, `catalunya`) now return **5 best-effort suggestions each**,
  where before this phase they returned 0 routed and 5 bare-coverage
  fallbacks. Gap counts range 6–23 legs per suggestion, inventing 567–2213 m
  of "street" (hungaroring: gaps 8/13/15/18/19, lengths 595/877/1090/1297/1351
  m; silverstone: gaps 6/12/14/20/23, lengths 567/1098/1372/1931/2213 m;
  catalunya: gaps 13/19/20/21/23, lengths 985/1440/1515/1628/1749 m).
  `routedCount` stays 0 for all three — unsurprising and unchanged by design:
  this phase deliberately left `MAX_LENGTH_RATIO` alone (see *Current
  priority* above for what that implies next). 270 tests pass (`npm run
  build` clean); the real-data test itself (`loopSearch.test.ts`) is
  CPU-heavy enough (building the full ~70k-node graph, routing dozens of legs
  per candidate across a 24-candidate pool, three times) that it needs a
  quiet machine to finish inside its existing 180 s budget — confirmed
  passing in isolation, and the specific numbers above were captured that
  way, but it timed out under heavy unrelated load on the development
  machine during this session (alongside several *other*, unmodified tests
  timing out the same way) — an existing resource-profile characteristic of
  this real-data test, not a Phase 10 regression, and not something this
  phase's scope covers fixing. Full spec:
  `docs/specs/phase-10-best-effort-routed-loops.md`.

- **2026-09-11 — Phase 10 spec written: stop rejecting, start marking.**
  Directly prompted by user feedback that a suggestion should read as "a
  route in the city," not "a shape that overlaps streets" — and by Phase 9's
  finding that Phase 8's all-or-nothing validation (every leg connects and
  the total stays under `MAX_LENGTH_RATIO`, or the whole candidate is
  discarded) is what's actually keeping every bundled circuit at zero routed
  suggestions, not connectivity. Decision: add a new **best-effort loop**
  kind that never fails — build the loop leg by leg around a Phase 6
  candidate, keep every leg that connects by real street, and draw any leg
  that doesn't as a straight line flagged `real: false` (rendered red)
  instead of rejecting the candidate. Ranks between Phase 8's fully-routed
  loops and the old bare coverage-percentage fallback, ordered by
  `gapLengthM` (metres of invented "street") ascending. `app/trace.ts`'s
  `expandRoute` — which already silently falls back to a straight line per
  leg for manual tracing, just never told the caller which legs those were —
  becomes `expandRouteWithGaps` and is reused by both manual tracing and the
  new suggestion kind, so **Trace route** also starts showing red gaps, not
  just new suggestion rows: one join mechanism, two callers, not two
  implementations. No change to `MAX_LENGTH_RATIO`, `CORRIDOR_M`, or any
  other existing constant, and no persisted gap state — gap-ness is always
  recomputed from the current graph at render time, the same
  recompute-don't-persist pattern Phase 3 and Phase 7 already use. Full
  spec: `docs/specs/phase-10-best-effort-routed-loops.md`.

- **2026-09-11 — Phase 9 shipped: connectivity fixed, but it wasn't the last
  blocker.** `graph.ts`'s `buildGraphCore` gained a third repair pass after
  Phase 7's endpoint-merge and endpoint-into-interior split: for every pair
  of segments from different ways, a true segment-to-segment closest-approach
  test (`segSegClosestApproach` — 0 if they cross, else the minimum of the
  four endpoint-to-opposite-segment distances) connects them if within
  `CORRIDOR_M`, at their actual crossing point or closest-approach midpoint.
  Deduped to **one connection per pair of ways** (the single closest
  approach), not one per segment pair — an early version created ~30k+
  crossings by reconnecting the same two ways repeatedly wherever a footway
  ran alongside its road, which both bloated the graph and multiplied
  false-merge exposure for no connectivity benefit. A `nearAnyWayEndpoint`
  guard skips any crossing landing within `NODE_MERGE_M` of either way's own
  first/last point, since that case is already Phase 7's job — without it,
  pass 3 re-discovered ordinary shared endpoints as "crossings" and created a
  redundant node on top of every one (broke `nodeCount` on several of Phase
  7's own synthetic tests before this guard was added).
  **Real-data result:** largest connected component **88.3% → 95.3%**
  (`graph.test.ts`'s floor raised from 0.75 to 0.9 accordingly) — confirmed a
  genuine fix, not a tuning artefact, by spot-checking two of the largest
  now-merged fragments (a Boavista-area residential grid, the Ribeira/Ponte
  Luiz I hillside) against live OSM data via Overpass: both are real,
  connected streets in the source data that the bundled graph had shown as
  isolated islands.
  **The acceptance bar this phase was written for — at least one bundled
  circuit returning a routed suggestion — was not reached.** Diagnosing why,
  candidate by candidate: even once a candidate's every leg connects
  (`connectFail: 0`), Phase 8's `MAX_LENGTH_RATIO` (1.5×) still rejects it —
  the real routed length came out 1.5–2× the circuit's length at
  `CORRIDOR_M=6`. Raising `CORRIDOR_M` does eventually push some candidates
  under that cap (1.44–1.50× at 30m, 1.45–1.47× at 40m for two of the three
  circuits) — but was rejected as an unsafe way to get there: past ~8–10m the
  same mechanism starts bridging streets that were never the same junction.
  Caught two ways: Phase 8's own `disconnectedQuad` test fixture (two street
  sides deliberately pulled 8m apart to model "definitely not connected")
  started passing once `CORRIDOR_M` reached that gap; and a real-data
  spot-check against OSM `bridge=yes`/`bridge=viaduct` tags in the bundled
  bbox found the count of plausible false merges climbing from ~230 at 6m to
  over 1,000 at 20m. `CORRIDOR_M` ships at the spec's original conservative
  `6` — real, contained improvement, not a number stretched to hit a
  headline. `GRADE_SEPARATED_EXCLUSIONS` was populated with 8 real
  grade-separated locations found this way (the Douro bridges — Infante Dom
  Henrique, Luiz I both decks — plus the Areosa, Linhas de Torres/Alameda de
  Cartes, General Sousa Dias/Ribeira-gorge, and Via Engenheiro Edgar Cardoso
  viaducts, and the Circunvalação's grade separation), `EXCLUDE_RADIUS_M`
  raised from the spec's 15 to 25 to cover a clustered set of them with one
  point each. This mitigation is partial, not exhaustive — enumerating every
  grade-separated point in a hilly city is out of scope for a short hardcoded
  list, and is noted as such rather than overclaimed.
  New `graph.test.ts` coverage: a true mid-segment crossing connects (and a
  regression check that it wouldn't without this pass); a near-miss within
  `corridorM` connects; one farther apart does not; an excluded crossing
  stays disconnected despite being within `corridorM`; a `fast-check`
  property that adding this pass never shrinks the largest component
  (monotonic, since it only adds edges). `match/loopSearch.test.ts`'s
  real-data test now loops over all three circuits and logs each one's routed
  count, deliberately without asserting a specific number — same honesty
  Phase 8's own real-data test already practised when it also found zero.
  256 tests pass (`npm run build` and `npm run test:run` both clean).
  **What this means for next:** the newly-precise blocker is
  `MAX_LENGTH_RATIO`, a Phase 8 constant this phase deliberately left alone.
  See *Current priority* above. Full spec:
  `docs/specs/phase-9-graph-connectivity-repair.md`.

- **2026-09-11 — Phase 9 spec written, following a connectivity
  investigation.** Prompted by Phase 8's real-data result (0 routed
  suggestions for all three circuits) and by user feedback that suggestions
  should be a real connected route, not just overlapping points. Investigated
  before writing anything: (1) the component-size distribution at the current
  `NODE_MERGE_M=4` is not a few big disconnected blocks but ~2 427 fragments,
  mostly small, ~127km of "substantial" (>100m) fragments outside the largest
  component; (2) sweeping `NODE_MERGE_M` from 1–100m showed the largest
  component barely moves between 4–10m (87.9–88.6%), only climbing past 90%
  around 15–20m — ruling out "just raise the tolerance" as a fix, confirmed
  directly by rerunning Phase 8's `searchRoutedLoops` at `nodeMergeM=20`:
  **still 0/5 routed for all three circuits**, identical to `4m`; (3)
  instrumented `tryRouteLoop`-equivalent diagnostics on the top-5 candidates
  per circuit showed the failures are consistently `shortestPath` returning
  null for 4–15 of 60 legs — never a snap failure, never the length-ratio
  cap; (4) spot-checked two of the largest disconnected fragments (Boavista
  area, Ribeira/Ponte Luiz I hillside) against **live OSM data via Overpass**
  — both are genuinely connected, dense street networks in the real data,
  confirming the gap is introduced by this project's own bundling, not a
  real-world absence of streets; (5) the actual cause: Phase 7's repair only
  ever merges way **endpoints** (endpoint-endpoint, endpoint-into-interior);
  it never tests whether two ways **cross** or run close together at an
  interior point of both, which is exactly what per-way-independent
  Douglas–Peucker simplification tends to erase at real junctions where
  neither through-way's shape needs the junction vertex to stay within its
  own tolerance. Tested a segment-to-segment crossing/corridor check as a
  replacement mental model for "give streets width" (the user's suggestion):
  largest component jumped from 88.3% to **96.7%** with pure crossing
  detection (zero added width), then 97.6% at a 3m corridor, up to 99.3% at
  15m — confirming the crossing test itself does most of the work, width is
  a secondary refinement. Decision: Phase 9 adds this as a third repair pass
  in `graph.ts` (`CORRIDOR_M` starting at 6m, tuned during implementation),
  plus a short hardcoded exclusion list for known grade-separated crossings
  (the Douro bridges, any grade-separated Circunvalação point) so the
  necessarily-2D crossing test doesn't wrongly merge roads that only pass
  over/under each other — consistent with VISION.md's "no elevation"
  non-goal, a targeted patch rather than a general fix. No change to
  `porto-streets.json` or its extraction pipeline. All investigation code was
  throwaway (run and discarded, not committed). Full spec:
  `docs/specs/phase-9-graph-connectivity-repair.md`.

- **2026-09-11 — Phase 8 shipped.** Routed loop suggestions. `graph.ts`'s
  `shortestPath` gained `edgeIds: readonly number[]` (additive; `app/trace.ts`'s
  `expandRoute` unaffected). New pure `match/loopSearch.ts`: `tryRouteLoop`
  resamples a candidate's placed outline at `LOOP_SAMPLES=60` even points,
  requires every one to resolve via `StreetGraph.nearestPointM(_,
  LOOP_SNAP_MAX_M=30)` and every consecutive pair (closing the loop) to
  connect via `shortestPath` — any miss fails the whole candidate, no
  straight-line patching. A successful loop over `MAX_LENGTH_RATIO=1.5`× the
  circuit's length is still rejected. `simple` is a single pass over a `Set`
  of edge ids across legs — cheap, no geometry. `searchRoutedLoops` reuses
  Phase 6's `searchPlacements` unchanged (pool size `LOOP_CANDIDATE_POOL=24`)
  to find candidate poses, tries routing best-rank-first until
  `LOOP_RESULT_COUNT=5` routed suggestions are found or the pool runs out,
  then backfills remaining slots with untried/failed candidates as Phase 6
  fallback suggestions — final order: simple routed (by `meanDeviationM`) ,
  then non-simple routed, then fallback in original rank. Loop deviation
  reuses `app/trace.ts`'s `routeStats` (not Phase 6's turning/Procrustes
  machinery), per the spec's "plain metres, no score" principle.
  `app/suggest.ts`'s slice-pump loop was extracted into a shared `pump<P,R>`
  helper used by both the existing `createSuggester` and the new
  `createLoopSuggester`; `app/map.ts` now builds only the loop suggester (its
  fallback-only output already reproduces Phase 6's own shape, so one
  suggester serves the button), adds an inert dashed `previewRouteLine` layer
  for hovering a routed suggestion, and `applyPlacement` (now taking an
  optional `route` param) seeds the traced route from a routed suggestion's
  loop points on **Use this**. `ui/controls.ts`'s `formatSuggestionLabel`
  branches three ways (simple loop / non-simple loop / fallback coverage %);
  the running-progress panel now shows which stage is active ("Searching
  placements…" / "Checking routes…") from the search's own `phase` field.
  **Real-data result — the headline finding, not just a tuning note:** at 1:1
  scale, all three bundled circuits (`hungaroring`, `silverstone`,
  `catalunya`) returned **0 routed suggestions** — every suggestion shown
  today is still a Phase 6 fallback (~2.4–2.7 s per search, well within
  budget). Verified this is a real data characteristic and not a bug in this
  phase's code: `graph.nearestPointM` resolves every sampled point (0 snap
  failures in every trace tried); the failures are consistently
  `shortestPath` returning `null` for a handful of the ~8–60 legs per
  candidate, i.e. genuine disconnects — consistent with Phase 7's own
  measurement that only 88.3% of the bundled network's length sits in its
  largest connected component. Tried scales 0.3/0.5/0.7/1.0, `loopSamples`
  as low as 8, and `loopCandidatePool` up to 80 — same result throughout, so
  this is not a tuning-constant problem. All synthetic-network tests (the
  ones that pin down `tryRouteLoop`/`searchRoutedLoops` behaviour precisely)
  pass; see *Current priority* above for what this implies for the next
  phase. 253 tests pass (`npm run build` and `npm run test:run` both clean).
  Full spec: `docs/specs/phase-8-routed-loop-suggestions.md`.

- **2026-09-11 — Phase 8 spec written.** Routed loop suggestions, prompted
  directly by user feedback that suggestions still sit over buildings.
  Decision: **validate, don't search freeform** — reuse Phase 6's
  `searchPlacements` unchanged (called with a larger candidate pool,
  `LOOP_CANDIDATE_POOL=24`) to find *where* to look, then for each candidate
  try to build a real closed loop with Phase 7's graph: `LOOP_SAMPLES=60`
  even points around the placed outline must all snap to the network
  (`LOOP_SNAP_MAX_M=30`) and every consecutive pair, including the closing
  leg, must connect by `shortestPath` — any single miss fails the whole
  candidate (stricter than tracing's advisory straight-line fallback, since a
  *suggestion* claims a real loop exists). A successful loop longer than
  `MAX_LENGTH_RATIO=1.5`× the circuit's length is still rejected (catches a
  legitimately-connected but far-detouring loop). Follow-up after the first
  draft: connected isn't the same as a real closed loop — nothing stops the
  path between one pair of samples from reusing a street another leg already
  walked (a single-access side street forcing a there-and-back is the common
  case). `graph.ts`'s `shortestPath` result gains `edgeIds` (additive, the
  only other caller — `app/trace.ts`'s `expandRoute` — is unaffected) purely
  so a loop attempt can flag `RoutedLoop.simple` (true iff no edge id is
  reused across legs), with no geometry work; simple loops always rank above
  non-simple ones, which still rank above fallback suggestions. Routed
  suggestions are
  labelled with real loop length + deviation from the circuit shape, reusing
  `app/trace.ts`'s `routeStats` — a deliberate departure from the ROADMAP's
  older "turning function + Procrustes on the routed loop" note, in favour of
  already-shipped plain-metres code that fits the vision's "no score"
  principle better once a real path exists to measure. Graceful fallback:
  when fewer than `LOOP_RESULT_COUNT=5` candidates route successfully, Phase
  6's old geometry-only suggestions backfill the remainder, so the list is
  never emptier than before this phase. `app/state.ts`'s `applyPlacement`
  gains an optional `route` param so using a routed suggestion seeds an
  editable traced route, not just a placement. All five constants are starting
  points, to be tuned against real data during implementation like Phase 6's
  were. Full spec: `docs/specs/phase-8-routed-loop-suggestions.md`.

- **2026-09-11 — Phase 7 shipped.** Routable street graph & routed tracing.
  `src/graph.ts` builds a `StreetGraph` once from the bundled ways:
  `buildStreetGraph` merges way endpoints within `NODE_MERGE_M` (4 m) into
  nodes, then a second pass lets any still-unmatched endpoint split another
  way's interior segment (a T-junction) if one lands within tolerance —
  repairing connectivity from the independent-per-way Douglas–Peucker
  simplification without touching `porto-streets.json`. Routing is
  hand-written A* (`shortestPath`), Euclidean straight-line heuristic, a
  sorted-insert array as the open set. `nearestNode` / `nearestPointM` resolve
  a click to the network via an expanding-radius grid search rather than
  scanning a box sized by the caller's `maxM` up front — needed once
  `app/trace.ts`'s `expandRoute` started asking "nearest node, no real
  distance limit" for waypoints already known to be on the network; the naive
  approach made that call take seconds. `app/trace.ts` gained `expandRoute`
  (waypoints → routed polyline, straight-line fallback per leg if the graph
  can't connect a pair); `routeLengthM`/`routeDeviation`/`routeStats` are
  unchanged, callers just pass the expanded polyline. `app/map.ts`: trace-mode
  clicks inside the bundled bbox resolve via `nearestPointM(_, SNAP_MAX_M=30)`
  and are dropped if nothing is in range; outside the bbox, clicks keep
  Phase 5's raw straight-line behaviour (no street data there). The drawn/
  measured route is always the expanded polyline; `AppState.route` and
  `SavedPlacement` keep storing just the waypoints, unchanged.
  **Real-data connectivity** (the acceptance criterion this phase's spec
  asked for): the largest connected component covers **88.3%** of the bundled
  network's total length — a materially connected network, not a field of
  fragments. Measured via a `componentLengthsM` export (union-find over the
  graph's own edges) added alongside `buildStreetGraph` for this test, since
  reconstructing connectivity from raw way endpoints outside the graph turned
  out to under-count it badly (missed exactly the T-junction connections this
  phase exists to add — a first version of the test wrongly reported ~28–44%
  before that bug was found). No new dependency, no new data file, no change
  to `SavedPlacement`'s stored shape or `PLACEMENTS_SCHEMA_VERSION`. 228 tests
  pass.

- **2026-09-11 — Phase 7 spec written.** Routable street graph & routed
  tracing. Scoped narrower than the roadmap's old "routable street graph"
  Later item on purpose: build the graph and use it for **tracing only**
  (clicks snap to the network, consecutive waypoints join via a real A*
  shortest path instead of a straight line); finding a closed loop shaped like
  the circuit — and using that to route Phase 6's suggestions — is split out
  to its own later item, since it is a materially harder problem than routing
  between two clicked points. Key design point: `porto-streets.json`'s ways
  were Douglas–Peucker–simplified **independently per way**, so shared
  junction vertices are not guaranteed to survive on both sides — the graph
  repairs connectivity at runtime by tolerance (`NODE_MERGE_M` merges nearby
  endpoints; a dangling endpoint near another way's segment interior splits
  that way and inserts a node) rather than by touching the bundled data or its
  extraction pipeline. New pure `graph.ts` (`buildStreetGraph`, A* routing);
  `app/trace.ts` gains `expandRoute`; `app/map.ts` wires snap-on-click and
  renders the routed polyline. `AppState.route` and `SavedPlacement`'s stored
  shape are unchanged — the routed path is derived from the (static) graph,
  never persisted. No new data file, no new dependency. Full spec:
  `docs/specs/phase-7-street-graph.md`.

- **2026-09-11 — Proximity made directional (Phase 3 + 6 fix).** Feedback: the
  "on a street" test was too permissive — a stretch went green just for passing
  within 10 m of *any* street, even one it only crosses, so the shape could
  "hop between buildings" and still score ~85 %. And the Phase 6 suggestion
  label (coarse-sample coverage) disagreed with the live map figure after
  applying (88 % vs 81 %). Fixes:
  - **Heading gate.** `StreetIndex` gained `nearestAlignedM(p, heading, maxM,
    maxAngleRad)` — only street segments whose bearing is within `ALIGN_MAX_DEG`
    (**35°**, compared mod 180°) of the circuit's local heading count.
    `app/proximity`'s `segmentCoverage` uses the segment's own direction;
    `match/objective` uses a ±2-sample central-difference tangent. A shape that
    cuts across the blocks now scores low even where it clips street after
    street. `alignMaxRad: Math.PI` opts out.
  - **One source of truth for the label.** After the search returns, `app/map`
    re-labels every suggestion with `lapProximity(...).nearFraction` and a new
    `lapDeviation(...)` computed on the *actual* placed ring — the exact figures
    the panel shows once "Use this" is pressed — and re-sorts by that. The
    search's internal objective stays a fast ranking proxy.
  - `MIN_COVERAGE` 0.45 → 0.40 so the honest (now lower) numbers still yield a
    list. Real Porto suggestions land around **50–63 % on streets, ~10–14 m
    avg** — lower than before, but real. Connectivity (that the aligned
    fragments actually join into a runnable loop) still needs the routable
    graph. 215 tests pass.

- **2026-09-10 — Phase 6 shipped.** Suggested placements. An opt-in **Suggest
  placements** button under the circuit picker runs a coarse→fine translation +
  rotation sweep (fixed scale) of the chosen circuit over the bundled Porto
  street index and shows up to five ranked starting spots, each labelled
  *"NN % on streets · ~NN m avg"*. Hovering a row previews its outline dashed
  (Phase 4 style, no state change); **Use this** drops the circuit there via a
  new pure `applyPlacement` reducer (clears the traced route, `window.confirm`
  first if one exists) and pans to it — still fully draggable. The search is a
  synchronous generator `searchPlacements` (coarse grid + rotation sweep → keep
  top N → local refine → de-dupe → top 5); `app/suggest.ts`'s `createSuggester`
  pumps it in ≤ `SLICE_MS` (12 ms) bursts with a `setTimeout(0)` between them, so
  the panel shows a live `<progress>` and **Cancel** works — no Web Worker.
  Per-candidate objective (`match/objective.ts`): Phase 3 **coverage** (drop
  below `MIN_COVERAGE` 0.45, and short-circuit the shape terms there for speed)
  − `W_TURNING`·**turning-function distance** (new pure `geometry/turning.ts`)
  − `W_PROCRUSTES`·**Procrustes residual** of the snapped samples, normalised by
  the circuit radius (new pure `geometry/procrustes.ts`, closed-form 2-D
  similarity, no reflection). `StreetIndex` gained `nearestPointM` (and the
  internal segment scan dropped its per-query `Set`). Turning / Procrustes are
  ranking-only — no headline match score, keeping *judgement with the user*.
  **Tuning vs the spec:** the spec's constant table
  (`COARSE_KEEP 24`, refine `180/60` m & `18/6`°, samples `48/96`) put the
  real-data search at ~10–13 s; trimmed to `COARSE_KEEP 16`, refine `180/90` m &
  `18/9`°, samples `40/80`, which still nails a planted optimum and lands the
  real Porto search at **~3–7 s** on a laptop (sliced, so the UI never blocks).
  A typed-array index and/or a Web Worker are the noted next optimisation.
  Weights kept at the spec defaults (`0.15` / `0.20`). New pure
  `geometry/turning.ts`, `geometry/procrustes.ts`, `match/{types,objective,search}.ts`,
  `app/suggest.ts`; `applyPlacement` in `app/state.ts`; the "Suggest placements"
  section + handlers in `ui/controls.ts`; glue in `app/map.ts`. No new data
  file, no new dependency. 210 tests pass.

- **2026-09-10 — Phase 6 spec written.** Suggested placements — the geometry-only
  first cut of the roadmap's "automatic matching". Decisions locked: **opt-in**
  ("Suggest placements" button, never automatic) and **advisory** (a suggestion
  only sets the Phase 2 placement, which stays draggable). Search is over
  **translation + rotation at a fixed scale** (the current UI scale; real scale
  by default) against the **bundled Porto street index only** — no Overpass, no
  routable graph, so suggestions only ever land inside the Phase 3 bbox. A
  generator `searchPlacements` does coarse grid + rotation sweep → keep top 24 →
  local refine → de-duplicate → top 5; `app/suggest.ts` pumps it in ~12 ms
  slices on the main thread (progress bar + cancel; a Web Worker is a later
  drop-in if needed). Per-candidate objective: Phase 3 **coverage** +
  **turning-function distance** + **Procrustes residual** of the samples snapped
  to their nearest street points (`W_TURNING`/`W_PROCRUSTES` weights). Results
  are labelled with the familiar "NN % on streets" + a metres deviation — the
  turning/Procrustes numbers are internal ranking only, no headline match score
  (keeps the *judgement stays with the user* principle). New pure
  `geometry/turning.ts`, `geometry/procrustes.ts`, `match/objective.ts`,
  `match/search.ts`; `StreetIndex` gains `nearestPointM`; `applyPlacement`
  reducer. Routable-loop matching, beyond-Porto search, scale-target search and
  sketch matching are split out into the *Later* list. Full spec:
  `docs/specs/phase-6-suggested-placements.md`.

- **2026-09-10 — Phase 5 shipped.** Trace & study. A **Trace route** toggle puts
  the map into trace mode (the overlay locks, the handle hides); each map click
  appends a `[lon, lat]` vertex to `AppState.route`; **Undo point** / **Clear
  route** edit it. The panel shows the traced route's real length against the
  circuit length at the current scale (with the signed %) and a symmetric
  mean/max **deviation in metres** (`app/trace.ts`: `resample` both lines at
  `DEV_SAMPLE_M = 10` m, nearest-distance each way, Hausdorff-style max) — no
  match %. **Study view** strips the panel to that summary and hides the handle,
  circuit overlay, drag target and street layer, leaving map + route (browser
  print works; a print stylesheet / PNG export are Phase 6+). Persistence:
  `SavedPlacement` gained an optional `route` and `PLACEMENTS_SCHEMA_VERSION`
  went to `2`; `validatePlacement` accepts stored v1 records and upgrades them
  in memory (no route). Save / Revert / auto-restore / Delete and
  `hasUnsavedChanges` all carry the route. New pure `src/app/trace.ts`, plus a
  `route` field and reducers in `src/app/state.ts`
  (`addRoutePoint`/`undoRoutePoint`/`clearRoute`; `selectCircuit` clears it,
  `loadPlacement` restores it). No new data file, no new dependency. 171 tests
  pass.

- **2026-09-10 — Phase 5 spec written.** Trace & study. Decisions locked:
  tracing is **free clicking** (straight segments between clicked vertices, no
  snapping — snap-to-street stays Phase 6+); an explicit trace-mode toggle locks
  the overlay while active; editing is add / undo / clear only (no vertex
  drag). The route lives in `AppState.route` (`LonLat[]`) with pure reducers;
  `selectCircuit` clears it, `loadPlacement` restores it. Deviation is reported
  as **plain metres** — resample route + placed centreline at `DEV_SAMPLE_M =
  10` m, symmetric nearest-distance, show mean and max — explicitly **not** a
  single match %, consistent with Phase 3 and the *judgement stays with the
  user* principle; the panel also shows route length vs circuit length at the
  current scale. "Study view" is a UI-stripping toggle (hide panel controls,
  handle, circuit overlay, street layer; keep map + route + a summary with an
  Exit button); no print stylesheet or PNG export yet. Persistence:
  `SavedPlacement` gains optional `route`, `PLACEMENTS_SCHEMA_VERSION` → 2, with
  a tolerant in-memory upgrade of stored v1 records. New pure `src/app/trace.ts`
  (length + deviation); no new data file, no new dependency. Full spec:
  `docs/specs/phase-5-trace-and-study.md`.

- **2026-09-10 — Phase 4 shipped.** Save & restore a placement, one per circuit.
  The current placement is saved with **Save placement** into the single
  `localStorage` key `circuit-finder/placements` (a `{ [circuitId]: SavedPlacement }`
  object; a `SavedPlacement` is the Phase 2 `Placement` + `circuitId` +
  `schemaVersion: 1` + `savedAt`). It is **auto-restored** when the app opens on
  that circuit or the user picks it from the selector (the map pans to it).
  Saving over an existing entry with unsaved changes asks first; **Preview saved**
  draws the stored ring dashed and inert for comparison without touching state;
  **Revert to saved** and **Delete saved** (both confirmed) round it out. New
  pure `src/placements.ts` (validate / make / (de)serialise / store ops, tolerant
  parse) + `src/app/storage.ts` glue (degrades to a non-persistent session if
  `localStorage` throws) + a `loadPlacement` reducer in `src/app/state.ts` that
  takes an already-decoded `Placement` so `state` keeps no dependency on
  `placements` (would otherwise be a cycle via `MIN_SCALE`/`MAX_SCALE`). No new
  data files, no new dependency. 144 tests pass. A multi-attempt repository and
  file export/import stay ROADMAP Phase 6+.

- **2026-09-10 — Phase 4 scope narrowed and spec rewritten.** Dropped the named
  attempt library (list, rename, notes, bundled examples) and file
  export/import. Phase 4 is now: **one saved placement per circuit**, keyed by
  `circuitId`, in the single `localStorage` key `circuit-finder/placements` (a
  JSON object `{ [circuitId]: SavedPlacement }`, tolerant of corrupt/absent
  values and of `localStorage` being unavailable). A `SavedPlacement` is the
  Phase 2 `Placement` + `circuitId` + `schemaVersion` + `savedAt`. The saved
  placement is **auto-restored** when the app opens on that circuit or the user
  picks it from the selector (map pans to it). Save always overwrites the
  circuit's entry (confirm first if it exists and there are unsaved changes); a
  **Preview saved** toggle draws the saved ring dashed for comparison without
  touching state; **Revert to saved** and **Delete saved** round it out. New
  pure `src/placements.ts` + `src/app/storage.ts` glue + a `loadPlacement`
  reducer; no new data files, no new dependency. A multi-attempt repository and
  file export/import move to ROADMAP Phase 6+. Full spec:
  `docs/specs/phase-4-save-restore-export.md`.

- **2026-09-10 — Phase 4 spec written (superseded same day, see above).**
  Save/restore/export. Decisions locked:
  an *attempt* = Phase 2 `Placement` + `circuitId` + `name`/`notes`/timestamps +
  `schemaVersion` (nothing about street data or the proximity result is stored —
  both recompute on load). Persistence is one `localStorage` key
  (`circuit-finder/attempts`, a JSON array), tolerant of corrupt/absent values
  and of `localStorage` being unavailable (session stays non-persistent, no
  crash). Save always creates a new attempt; rename + notes edits are allowed,
  in-place geometry edits are not. Export/import is one attempt per file in a
  self-identifying versioned wrapper
  (`{ app, kind: "attempt", version, attempt }`); import always adds a copy with
  a fresh id. Two or three bundled load-only example attempts
  (`src/data/example-attempts.json`). No backend, no new dependency. Full spec:
  `docs/specs/phase-4-save-restore-export.md`.

- **2026-09-10 — Phase 3 shipped.** Street-proximity feedback: while the user
  moves or rotates the overlay, its centreline recolours live on a
  green → amber → red ramp by how much of each segment sits within 10 m of a
  real Porto street, plus a live "near a street: NN %" figure. Advisory only —
  no score, no snap, no auto-placement. A faint grey street layer (toggle, on by
  default) shows what the colouring reacts to. Pure modules with full unit +
  `fast-check` coverage: `geometry/nearest` (point↔segment), `streets`
  (loader/validator + uniform-grid spatial index, `CELL_M = 50`), `app/proximity`
  (per-segment coverage by 5 m sampling, `NEAR_M = 10`, `LEVELS = 8` colour
  buckets, green/amber/red lerp). New shared `src/porto.ts` (fixed Porto metric
  frame) and `src/attribution.ts` (attribution validator factored out of
  `circuits.ts`). Leaflet glue: `LEVELS` persistent bucket polylines, rAF-
  coalesced re-render. 94 tests pass.
  **Street data.** OSM runnable ways (ODbL), bundled as
  `src/data/porto-streets.json`, no runtime Overpass. The spec's nominal bbox
  (~11 × 9 km) as plain `[lon, lat]` arrays came in at ~1.9 MB — far over the
  ≤ 600 KB budget. Per the spec's escape hatch: reshaped the bbox to the real
  zoom-14 draggable area (`[-8.688, 41.135, -8.575, 41.183]`, ~9.4 × 5.3 km —
  narrower N–S than nominal, and pushed west so the west edge sits on the Foz do
  Douro coastline: the whole city is covered, panning outside just shows no
  colouring) **and** added a compact delta-integer encoding on a `1e-5`° lattice
  (max error ≈ 0.56 m). Result: 26 994 ways, 70 320 vertices, **588 563 bytes
  raw** (~575 KB, fits the budget), ~234 KB gzip. It is inlined into the JS
  bundle (like `circuits.json`) to keep zero runtime requests, so the production
  chunk is ~759 KB / ~289 KB gzip; `chunkSizeWarningLimit` raised to 800. DP
  tolerance 5 m; all listed runnable highway types kept. Extending coverage
  beyond this box (statically, or via a "load this area" button that fetches
  Overpass on demand) is noted as a Phase 6+ option.

- **2026-09-10 — Deploy target: GitHub Pages.** The repo lives on GitHub
  (`github.com/jnv7/circuit-finder`), never GitLab. Replaced `.gitlab-ci.yml`
  with `.github/workflows/deploy.yml` (test + build on every push/PR;
  `upload-pages-artifact` + `deploy-pages` from `main`). Vite `base`
  (`/circuit-finder/`) already matched a project-page path, so no build change.
  Supersedes the 2026-09-08 "must deploy to GitLab Pages" note; everything else
  in that entry (static, no backend, `localStorage` + JSON) still holds. Needs a
  one-time repo setting: *Pages → Source: GitHub Actions*.
- **2026-09-10 — Phase 2 shipped.** First interactive release: a Leaflet map
  fixed on Porto (OSM raster tiles, no key), a chosen circuit's centreline
  overlaid at true 1:1, drag-anywhere to move and a single handle to rotate,
  plus a live lap-length / longest-straight readout and a 0.5–3.0 scale
  multiplier. Leaflet is the only new runtime dependency; drag and rotate are
  wired directly on Leaflet pointer events (no plugin). State is one
  module-level object; a re-render is a pure `overlayLatLngs` recompute plus a
  polyline swap. Placement math (`app/overlay.ts`), rotation-from-pointer
  (`app/rotate.ts`) and the reducers (`app/state.ts`) are pure with unit +
  `fast-check` coverage; the Leaflet glue has one jsdom mount smoke test.
  Rotation sign convention: `rotationRad` is CCW in the local ENU frame and CCW
  on screen, 0 = handle straight up. 70 tests pass.
- **2026-09-10 — New Phase 3: street proximity feedback.** While the user moves
  the overlay by hand, colour it by how much of its length sits near real
  streets — an advisory hint, keeping judgement with the user (does not violate
  the "no match score required" principle). Approach: bundle a simplified Porto
  street network as a static asset, index it in a spatial grid, compute
  nearest-street distance as pure local geometry. Slots before save/trace; old
  Phases 3/4/5+ become 4/5/6+.
- **2026-09-09 — Phase 1 shipped.** Circuit geometry source: **OpenStreetMap**
  raceway ways (ODbL 1.0, per-circuit attribution stored in `circuits.json`; a
  normalised copy lives in the repo, no runtime fetch). Bundled circuits:
  `hungaroring`, `silverstone`, `catalunya` — all cleanly mapped as connected
  `highway=raceway`. **Monaco dropped** (street circuit; OSM mixes raceway and
  street ways with split carriageways — not cleanly stitchable this phase);
  Hungaroring took its slot. Monaco + Madrid stay roadmap candidates. Geometry
  runs in a local ENU metric frame via an equirectangular projection about each
  circuit's centroid. Toolkit: `src/geo.ts` + `src/geometry/` (vector, path,
  similarity transform without reflection, longest-straight). Added `fast-check`
  (dev-only) for property tests. 48 tests pass; computed lap lengths land within
  0.6% of published figures.
- **2026-09-09 — Phase 0 shipped.** Plain TypeScript modules + Vite (no
  framework). Deploy target: GitLab Pages **project site**, Vite `base` =
  `/circuit-finder/`. Toolchain landed on `node@24`, `typescript@7`, `vite@8`,
  `vitest@5` (0 audit vulnerabilities). Node was installed from the official
  prebuilt tarball to `~/.local/node` (Homebrew tried to build cmake from
  source). Circuit data is a typed JSON import for now; `fetch` + full schema
  come in Phase 1.
- **2026-09-08 — Project docs structure.** `docs/VISION.md` (stable goal),
  `docs/ROADMAP.md` (living), `CONVENTIONS.md` (rules), `docs/specs/` (one spec
  per phase, written when it becomes the priority).
- **2026-09-08 — Static site, no backend.** Must deploy to GitLab Pages.
  TypeScript + Vite + Leaflet + Vitest. Persistence via `localStorage` + JSON
  export/import. No Python, no server, no paid services.
- **2026-09-08 — Manual "acetate" workflow is the MVP.** Automated shape matching
  is deferred to Phase 6+. The user judges the fit by eye.
- **2026-09-08 — Real 1:1 scale by default**, with an optional multiplier.
  Satisfies "a 2 km circuit straight is a ~2 km route segment".
- **2026-09-08 — Transform: move + rotate only.** No reflection/mirror.
  Only overall shape matters; start/finish line position does not.
- **2026-09-08 — Fixed context for the MVP.** Map fixed on Porto; circuit list
  fixed and bundled. Freeing the map is a roadmap item.
- **2026-09-08 — No elevation** anywhere in the current design.
- **2026-09-08 — Map: Leaflet + OpenStreetMap raster tiles**, with attribution,
  no API key.

## Open questions

- OSM tile usage policy for a low-volume hobby deployment — confirm acceptable
  (relevant from Phase 2).
- Add Monaco and Madrid once their OSM geometry can be stitched into a clean
  centreline (Monaco needs manual assembly; Madrid needs OSM coverage of the
  IFEMA layout).
- **2026-09-11 — Phase 6 suggestions look clustered in one part of the bbox.**
  Confirmed by later real-world use (see the 2026-09-12 Phase 12 spec entry
  above): the coarse sweep/dedup was indeed under-exploring the rest of the
  grid. Spec written: `docs/specs/phase-12-anchor-on-real-streets.md` (real
  street straight matching + a diversity pass in final selection) — move to
  Resolved once shipped and confirmed on real data.

Resolved:

- ~~Circuit geometry source: OSM raceway ways vs. a public F1 GeoJSON dataset~~ →
  OpenStreetMap raceway ways, normalised copy in the repo (2026-09-09).
- ~~Which circuits to bundle first~~ → `hungaroring`, `silverstone`, `catalunya`
  (2026-09-09).

- ~~Frontend: plain TypeScript vs. a small framework~~ → plain TypeScript + Vite
  (2026-09-09).
