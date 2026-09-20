# Roadmap

Living document: phases, current priority, decisions, open questions, and future
ideas. See [VISION.md](VISION.md) for the product goal and
[../CONVENTIONS.md](../CONVENTIONS.md) for engineering rules.

## Current priority

**2026-09-21 — Phase 22 shipped; current priority moves to Phase 23.**
[specs/phase-22-route-generator.md](specs/phase-22-route-generator.md) is
implemented: `src/route/` (raster, poseSearch, mapMatch, pruneSpikes, metrics,
escalate), `src/routes.ts`, and `npm run generate-route -- <id>`. All three
bundled circuits are generated and committed
(`src/data/routes/{hungaroring,silverstone,catalunya}.json`); every one's top
route clears the acceptance bar. Full real-data figures and two honest
deviations from the spec's exact plumbing (a whole-recompute `pruneSpikes`
instead of an incremental one; the escalation ladder's own `PRUNE_POOL`
constant) are in the decision log entry of this date. Current priority is now
[specs/phase-23-routes-page.md](specs/phase-23-routes-page.md) — a second
static page, `routes.html`, that looks up a circuit's generated routes, draws
each on a real basemap next to the circuit outline, shows plainly how well it
matches, and downloads it as GPX (reuses Phase 18's `app/gpx.ts`, written now
if Phase 18 hasn't landed yet).

Phase 18 (GPX export from the existing trace/skeleton flow) and Phase 19
(circuit-extraction tooling) below are not abandoned — GPX export is now
needed sooner (by Phase 23) and circuit-extraction tooling still gates the
full calendar — just reordered behind 22/23. The existing suggestion/
skeleton page keeps working unchanged; whether to retire any of it is a
later, separate decision once the routes page has been used for real.

<details>
<summary>Previous priority (2026-09-20), superseded above but kept for
context</summary>

**2026-09-20 — direct user request supersedes the previous priority below.**
A 2026-09-20 session investigated the user's own concern that Phase 6-15
suggestions and Phase 14 skeletons don't look enough like the circuit, and
found the real lever: judge a **closed running route by its symmetric
distance to the circuit**, not "does the outline lie on streets" (full
findings in the decision log entry of that date). A prototype built on that
idea (candidate poses from an exhaustive raster search, then closed-loop
Viterbi map matching on the street graph, then spike pruning) clearly beat
Phase 14 on the user's own metric for all three bundled circuits. The user
then asked for this to become a real, offline, one-circuit-at-a-time
generator whose results are stored and looked up on a **new page**, with
GPX download for a receiving navigation app. Two specs, ready:

1. [specs/phase-22-route-generator.md](specs/phase-22-route-generator.md) —
   turns the prototype's pipeline into tested, committed modules
   (`src/route/`) plus a dev-only script, `npm run generate-route -- <id>`,
   that writes `src/data/routes/<id>.json`. Nothing runs in the browser.
2. [specs/phase-23-routes-page.md](specs/phase-23-routes-page.md) — a
   second static page, `routes.html`, that looks up a circuit's generated
   routes, draws each on a real basemap next to the circuit outline, shows
   plainly how well it matches, and downloads it as GPX (reuses Phase 18's
   `app/gpx.ts`, written now if Phase 18 hasn't landed yet).

Phase 18 (GPX export from the existing trace/skeleton flow) and Phase 19
(circuit-extraction tooling) below are not abandoned — GPX export is now
needed sooner (by Phase 23) and circuit-extraction tooling still gates the
full calendar — just reordered behind 22/23. The existing suggestion/
skeleton page keeps working unchanged; whether to retire any of it is a
later, separate decision once the routes page has been used for real.

</details>

<details>
<summary>Previous priority (2026-09-15), superseded above but kept for
context</summary>

**Stability confirmed, independently, 2026-09-15**: `npm run test:run` is
green with no timeouts under simulated CI load (`--maxWorkers=2`, run
twice); the live site (`https://www.jnvasconcelos.com/circuit-finder/`) is
confirmed serving a real Vite build (`/assets/index-*.js`/`.css`), and the
latest `CI + Pages` run on GitHub is green. Phase 16 and 17 (previous entry)
closed the stability gate the product direction was waiting on.

**Revised 2026-09-15, same day, on a direct user finding: a real correctness
problem in Phase 14's skeletons outranks adding more circuits.** A user
observed that a skeleton's honest-looking numbers can hide a **comb
pattern** — real, connected streets, but mostly retracing the same ground
rather than tracing new distance. Measured, not assumed: for the three
bundled circuits' own top placement, checking every leg pair's underlying
street edges found **hungaroring's top candidate overlaps on 10 of 10
possible adjacent leg pairs** (up to 23 shared edges between two legs
alone); silverstone 3 of 7, catalunya 5 of 8 including two non-adjacent legs
sharing 36 edges. `resolveLandmark` picks each landmark's best real street
independently, with no awareness of what a neighbour already claimed —
exactly Phase 8's old `RoutedLoop.simple` problem, recurring because Phase
14 never re-added that detection when it replaced Phase 8's mechanism.
Batch-adding ~21 more circuits onto a skeleton-builder with this defect
undisclosed would scale a hidden correctness problem 8×, not just add
content — fixing visibility comes first:

1. [specs/phase-20-detect-skeleton-backtracking.md](specs/phase-20-detect-skeleton-backtracking.md)
   — **done 2026-09-15**: skeletons now expose `retracedM`, split honestly
   across the landmarks that cause it, so the drag-to-fix design Phase 14
   promised ("the computer flags the 2-3 points that need it") actually can.
   Real figures for the three bundled circuits' top candidates: hungaroring
   1434 m retraced (of 6149 m — 23%), silverstone 361 m (of 6084 m), catalunya
   860 m (of 5135 m).
2. [specs/phase-21-avoid-skeleton-backtracking.md](specs/phase-21-avoid-skeleton-backtracking.md)
   — **rejected 2026-09-15**: prototyped exactly as sketched, measured
   against real data, found to structurally never change anything (see the
   spec's own outcome note and the decision log entry below for why). Not
   implemented; no automatic repair exists. Phase 20's honest disclosure is,
   for now, the whole of this problem's fix — the user drags the flagged
   landmarks by hand.
3. **Current priority moves to** [specs/phase-18-gpx-export.md](specs/phase-18-gpx-export.md)
   — a locked, ready spec, quick win, independent of the skeleton work:
   export the traced route as a `.gpx` file.
4. [specs/phase-19-circuit-extraction-tooling.md](specs/phase-19-circuit-extraction-tooling.md)
   — the enabler for the full calendar (Phase 20 alone already lets new
   circuits' skeletons be honestly labelled, so this no longer waits on 21):
   turns the manual, one-off OSM-extraction pipeline into a repeatable,
   validated tool.
5. **Batch-add the rest of the calendar** using Phase 19's tool — not yet
   spec'd as individual phases; see the classified roadmap below.

Phase 15 shipped 2026-09-14: spatial-quota coarse search — replaces
`coarseKeep`'s flat top-16-by-score selection with one-winner-per-macro-cell
selection, so the pool that reaches refine represents the whole bundled bbox
instead of one neighbourhood's internal score variation. Pure, stateless, no
circuit identity anywhere in the mechanism — see the decision log below for
the real macro-cell-representation numbers.

Phase 14 shipped 2026-09-14: corner-anchored, human-adjustable placement —
the actual replacement for the deleted rigid-pose loop search — see the
decision log below for the real corner/gap/length numbers.

Phase 14 shipped 2026-09-14: corner-anchored, human-adjustable placement —
the actual replacement for the deleted rigid-pose loop search — see the
decision log below for the real corner/gap/length numbers.

- ~~[specs/phase-14-corner-anchored-placement.md](specs/phase-14-corner-anchored-placement.md)
  — reduce the circuit to its significant corners, search each independently
  against real streets (not one rigid transform for all of them), route
  between them with the existing graph/A*, and let the user drag any corner
  to a better real street — then commit the result as a normal traced
  route.~~ **Done** — see the decision log below for the real-data result.
- ~~[specs/phase-11-straighten-best-effort-loops.md](specs/phase-11-straighten-best-effort-loops.md)
  — best-effort loops snap each sample to the nearest street point blind to
  direction, so a sample can jog onto a misaligned side street or driveway
  and back.~~ **Done** — see the decision log below for the real-data result.
- ~~[specs/phase-12-anchor-on-real-streets.md](specs/phase-12-anchor-on-real-streets.md)
  — resolved the 2026-09-11 open question below: suggestions clustered in one
  part of the bbox because the coarse grid sweep only ever proposed candidates
  from a blind grid, and dedup didn't encourage spread. Fix shipped: also seed
  candidates from real streets whose own longest straight matches the
  circuit's, plus an explicit diversity pass in final selection.~~ **Done** —
  see the decision log below for the real-data result.

Still true after Phase 11 and 12: `routedCount` (fully-connected loops) stays
0 for all three bundled circuits — `MAX_LENGTH_RATIO` still blocks that path,
unchanged by either phase by design (neither touches the length cap; Phase 11
only changes which point a sample resolves to, Phase 12 only changes which
poses get proposed and how the final list is spread). Full story: the Phase
10/11/12 decision-log entries below and
[specs/phase-10-best-effort-routed-loops.md](specs/phase-10-best-effort-routed-loops.md).

</details>

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

### Phase 11 — Straighten best-effort loops (direction-aware snapping) — `done`

Spec: [specs/phase-11-straighten-best-effort-loops.md](specs/phase-11-straighten-best-effort-loops.md).

- `StreetGraph` gained `nearestAlignedPointM`, mirroring `nearestPointM` but
  filtering candidate street segments by heading alignment first — the same
  "modulo π, compare `|cos|`" test `StreetIndex.nearestAlignedM` (Phase 6's
  own candidate scoring) already used, now reused for loop *construction* too.
- `tryRouteLoop`/`buildBestEffortLoop` snap each sample through it instead of
  plain nearest-distance, using the circuit's own local heading there
  (`objective.ts`'s `localHeading`, factored out of `scoreCandidate` so both
  call sites compute the same thing one way).
- A sample with no *aligned* street within `LOOP_SNAP_MAX_M` is unresolved,
  full stop — a gap for `buildBestEffortLoop`, a rejection for `tryRouteLoop`
  — never a silent fall-back to the nearest wrong-direction point.
- No change to `MAX_LENGTH_RATIO`, `LOOP_SAMPLES`, `LOOP_SNAP_MAX_M`,
  `CORRIDOR_M`, or manual **Trace route** (direction-blind snapping there is
  unaffected — this only touches suggestion construction).
- **Real-data result:** the real-data test (`loopSearch.test.ts`) now also
  logs each best-effort suggestion's `lengthM` as a multiple of the circuit's
  own length — Phase 10 only logged gap counts/lengths, so this is the first
  direct measurement of the thing this phase actually targets. Across all 5
  best-effort suggestions per bundled circuit: hungaroring 1.90×, 2.22×,
  2.76×, 1.89×, 1.91×; silverstone 1.87×, 1.50×, 1.57×, 1.43×, 1.22×;
  catalunya 1.89×, 1.97×, 2.04×, 1.84×, 1.95× — every circuit's best row now
  under 1.9×, down from the 2.1–3.6× range this spec's Goal section reported
  for Phase 10 (including the original 4.67 km → 10.02 km, ~2.15×, case that
  prompted this phase). `gapCount`/`gapLengthM` rose on every circuit (e.g.
  hungaroring's gap counts moved from 8–19 to 10–22) — the accepted trade this
  spec called out: a wrong-direction "real" leg that used to silently inflate
  length now correctly shows as an honest gap instead, so the total route got
  shorter while the gap tally grew. `routedCount` stays 0 for all three,
  unchanged by design (`MAX_LENGTH_RATIO` is Phase 12+ territory, not touched
  here).

### Phase 12 — Anchor candidates on real streets (longest-straight matching + geographic diversity) — `done`

Spec: [specs/phase-12-anchor-on-real-streets.md](specs/phase-12-anchor-on-real-streets.md).

- A second way to *propose* a candidate, alongside the existing blind grid
  sweep: `match/straights.ts`'s `findMatchingStreetStraights` finds every
  bundled street whose own longest straight run falls within `[0.6, 1.6]`×
  the circuit's own longest straight length, and `seedFromStraight` places the
  circuit's straight onto each match (both directions along the street). Seeds
  merge into the same coarse pool the grid sweep fills, so they get identical
  refine/dedup treatment — no separate code path.
- A two-pass accept in final selection: fill slots preferring candidates at
  least `diversityDistM` (800 m) from every already-accepted one, then fill
  any remaining slots by plain score — so a circuit with only one good spot in
  Porto still gets a full result set, never fewer than before this phase.
- No change to the grid sweep, its constants, or Phase 8/10/11's routing on
  top of whatever candidates come out.
- **Real-data result:** on the bundled circuits' final 5 suggestions, the
  maximum pairwise distance between accepted anchors — the spread metric this
  phase exists to improve — is now **hungaroring 4687 m, silverstone 5449 m,
  catalunya 1057 m** (`hungaroring`/`silverstone` picked up real matching
  streets far across the bbox; `catalunya`, with only 12 matching street
  straights found — fewer and more localised than the other two circuits'
  39/46 — spread less, an honest reflection of what real Porto streets offer
  for that circuit's longest straight, not a bug). Resolves the 2026-09-11
  clustering open question — see the decision log below for the full
  before/after context.

### Phase 13 — Retire the routed/best-effort loop from Suggest placements — `done`

Spec: [specs/phase-13-honest-suggestions.md](specs/phase-13-honest-suggestions.md).

- Deleted `match/loopSearch.ts` (and its types/tests) and reverted
  `app/map.ts`/`ui/controls.ts` to Phase 6/12's plain, honest
  coverage-percentage suggestion list — no length, no gap count, no "closed
  loop" wording.
- Motivated entirely by the 2026-09-13 review's evidence, not by any new
  finding of this phase's own.

### Phase 14 — Corner-anchored, human-adjustable placement — `done`

Spec: [specs/phase-14-corner-anchored-placement.md](specs/phase-14-corner-anchored-placement.md).

- Reduces a circuit to its significant corners (`geometry/corners.ts`,
  new), resolves each independently against real streets within its own
  search radius (`match/landmarks.ts`, new, built on the existing
  `graph.ts`), and lets the user drag any corner to a different real street —
  recomputing only its two adjacent legs — before committing the result as a
  normal traced route (`app/state.ts`'s new `setRoute`).
- Judged against a concrete bar: at least two of the three bundled circuits
  should come in under 1.2× real length with under 4 gaps at the best
  candidate placement, *before* manual dragging — a material improvement over
  Phases 10-12's 1.43-2.24× / 10-29 gaps.
- **Real-data result: only 1 of 3 circuits clears the full bar** (Catalunya,
  1.00×/2 gaps) — Silverstone clears the length half but not the gap half
  (1.00×/4 gaps, the spec's bar is *under* 4) and Hungaroring clears neither
  (1.41×/0 gaps). Shipped anyway per the spec's own instruction, with the
  honest number recorded rather than the bar declared met — see the decision
  log below for the full tuning story.

### Phase 15 — Spatial-quota coarse search — `done`

Spec: [specs/phase-15-spatial-quota-search.md](specs/phase-15-spatial-quota-search.md).

- `match/search.ts`'s coarse-keep step — previously a flat "sort every
  scored coarse candidate by score, take the top `coarseKeep`" — now buckets
  every scored candidate (grid sweep and Phase 12's straight-anchored seeds,
  same merged array as before) into `spreadCellM` (2000 m) macro-cells, keeps
  only each occupied cell's best-scoring candidate, then takes the top
  `coarseKeep` of those macro-cell winners. A macro-cell with no viable
  candidate contributes nothing; an already-represented cell is never padded
  with a second candidate, by design.
- Pure and stateless: the fix is entirely inside one circuit's own coarse
  sweep, a function of that circuit's own scored candidates and the bbox's
  fixed geometry — no session memory, no `circuitId`-keyed logic, unaffected
  by how many circuits exist or what order they're searched in.
- No change to `coverage`/`turningDistance`/`procrustesResidual` or their
  weights, to `diversityDistM`, `dedupDistM`, or `coarseKeep`'s own value —
  all three were tried and measured during the investigation that produced
  this phase's spec and found not to be the lever (see the decision log).
- **Real-data result:** per bundled circuit, the macro-cell count the coarse
  sweep actually found candidates in, vs. how many of those cells today's old
  flat top-16 selection reached, vs. how many Phase 15's spatial-quota keep
  reaches (same `coarseKeep = 16` budget throughout) — **hungaroring: 17
  occupied, flat top-16 reached 3, spatial-quota reaches 16; silverstone: 13
  occupied, flat reached 4, spatial-quota reaches all 13; catalunya: 16
  occupied, flat reached only 1, spatial-quota reaches all 16.** The final
  5-suggestion result list (after refine/dedup/Phase 12's diversity pass)
  now spans 5 distinct macro-cells for every circuit (previously not
  measured directly), and the maximum pairwise distance between final
  anchors grew to hungaroring 6744 m, silverstone 4826 m, catalunya 6482 m
  (up from Phase 12's 4687/5449/1057 m — catalunya in particular, previously
  the least spread circuit at 1057 m, now spreads the most of the three
  relative to its own Phase 12 baseline, since its 16 occupied macro-cells
  were previously reduced to just 1 by the flat selection). One existing
  Phase 12 test (`search.test.ts`, "diversity in final selection") needed
  updating: its three-anchor "crowded cluster" fixture (300-424 m spread) now
  collapses into a single macro-cell under a 2000 m `spreadCellM`, so only
  one of those three anchors ever reaches `kept` — the test now asserts that
  honest, documented "no padding" outcome (1 suggestion, not the previously
  expected `resultCount`) instead of the pre-Phase-15 behaviour. 5 new tests
  added covering the dense-cluster-vs-scattered-cells regression guard, empty
  vs. single-candidate macro-cells, fewer-occupied-cells-than-`coarseKeep`,
  and a straight-anchored seed becoming its own cell's winner. 284 tests pass
  (`npm run build` clean); the same load-sensitive timeouts noted in every
  prior phase's decision-log entry (`graph.test.ts`'s real-data connectivity
  check, several `app/map.test.ts` cases) appeared under full-parallel
  `npm run test:run` and passed cleanly re-run in isolation — not a
  regression from this phase.

### Phase 16 — Fix the flaky real-data tests (share the graph fixture, real timeouts) — `done`

Spec: [specs/phase-16-fix-flaky-real-data-tests.md](specs/phase-16-fix-flaky-real-data-tests.md).

- `createMapApp` gains an optional fourth `MapAppDeps` parameter
  (`network`/`streetIndex`/`streetGraph`), defaulting to building them itself
  — today's behaviour — when omitted; `main.ts`, the one production caller,
  is unaffected.
- `app/map.test.ts` builds the network/index/graph once in a module-level
  `beforeAll` and passes them into all 18 `createMapApp(...)` call sites,
  removing ~18× redundant ~2.9 s graph builds from the file.
- Every real-data test now carries an explicit, generous timeout instead of
  Vitest's 5000 ms default: `graph.test.ts`'s connectivity test gets
  `30_000`, every `app/map.test.ts` suite gets `15_000` (via `describe(...,
  { timeout: 15_000 }, ...)`).
- **Real-data result:** `app/map.test.ts` alone: 48.5 s → 10.3 s (Duration),
  wall-clock `time`: ~50.2 s → ~12.2 s — matches the spec's "~49 s of
  redundant work removed" estimate. Two consecutive full-suite runs under
  `npx vitest run --maxWorkers=2` (approximating the 2-vCPU GitHub Actions
  runner that failed on 2026-09-14): 284/284 passed both times (27.8 s and
  25.2 s), zero timeouts either run. `npm run build` and `npm run test:run`
  both clean (284/284). No assertion's expected behaviour changed anywhere
  in either file.

### Phase 17 — Harden the deploy pipeline (correct Pages source, post-deploy smoke check) — `done`

Spec: [specs/phase-17-harden-deploy-pipeline.md](specs/phase-17-harden-deploy-pipeline.md).

- **Step 1 (manual, one-time): repository Settings → Pages → Source
  corrected to "GitHub Actions"** — done by the maintainer directly (not a
  code change; no tool used by this session has repository-admin access to
  verify or perform it). This is the actual root fix for "the live site
  serves raw source" from the 2026-09-15 investigation.
- **Step 2 (code): a "Verify the deployed site" step added to the end of
  `.github/workflows/deploy.yml`'s `deploy` job**, right after
  `actions/deploy-pages@v4` — fetches the deployment's own reported
  `page_url` and fails the job loudly if the body contains `/src/main.ts`
  (raw source signature) or lacks a `/circuit-finder/assets/*.js` reference
  (the real Vite build's actual output pattern, confirmed against a local
  `npm run build`'s `dist/index.html`). Runs unconditionally after every
  successful deploy, not just as a one-off check of this incident.
- No change to the `build` job or any application file — exactly as scoped.
- **Verified both directions before shipping** (the same "prove the guard
  rail catches what it's meant to catch" discipline as Phase 9's crossing-
  detection tests): ran the check's exact `grep` logic locally against (a) a
  synthetic raw-source HTML body — caught, fails as designed; (b) the real
  `dist/index.html` from a clean `npm run build` — passes, no false
  positive.

### Phase 18 — GPX export of the traced route — `todo`

Spec: [specs/phase-18-gpx-export.md](specs/phase-18-gpx-export.md). A pure
`app/gpx.ts` (`buildGpx`, `gpxFilename`) plus a button next to Study view
that downloads `AppState.route`/a committed Phase 14 skeleton as a `.gpx`
`<trk>`. Not yet implemented; Phase 22/23 (below) need `app/gpx.ts` sooner
than this phase's own UI and will create it if this hasn't landed first.

### Phase 19 — Circuit-extraction tooling — `todo`

Spec: [specs/phase-19-circuit-extraction-tooling.md](specs/phase-19-circuit-extraction-tooling.md).
`geometry/simplify.ts` (Douglas–Peucker) plus a dev-only
`scripts/extract-circuit.ts` that turns the documented-but-uncommitted OSM
extraction pipeline into a repeatable, validated tool — the enabler for
batch-adding the rest of the F1 calendar. Not yet implemented.

### Phase 20 — Detect skeleton backtracking — `done`

Spec: [specs/phase-20-detect-skeleton-backtracking.md](specs/phase-20-detect-skeleton-backtracking.md).
Skeletons expose `retracedM`/`LandmarkAnchor.retraceM` (edge-sharing detected
via `shortestPath`'s `edgeIds`, split evenly across the legs/landmarks that
share an edge) and a third amber marker style, so a skeleton that hides
"comb" backtracking behind honest-looking length/gap numbers now shows it.
See the 2026-09-15 decision log entries for the real figures (hungaroring
23% retraced, silverstone/catalunya smaller but real).

### Phase 21 — Avoid skeleton backtracking (local repair pass) — `rejected`

Spec: [specs/phase-21-avoid-skeleton-backtracking.md](specs/phase-21-avoid-skeleton-backtracking.md).
Prototyped exactly as sketched (re-resolve a retracing landmark excluding
edges its neighbours already used) and measured: **zero effect**, on every
landmark, on both circuits tested — structural, not tunable, because a
landmark's already-resolved point can never be the one excluded. Not
implemented; see the 2026-09-15 decision log entry for the full diagnosis.
Superseded in spirit by Phase 22's map matching, which resolves every
landmark *jointly* instead of independently — the redesign this rejection
said would be needed.

### Phase 22 — Route generator (offline, stored results) — `done`

Spec: [specs/phase-22-route-generator.md](specs/phase-22-route-generator.md).
Turns the 2026-09-20 prototype (exhaustive pose search → closed-loop Viterbi
map matching on the street graph → spike pruning) into tested modules
(`src/route/`) and a dev-only `npm run generate-route -- <circuitId>` script
that writes `src/data/routes/<circuitId>.json`. Judges a route by the
user's own metric — symmetric distance to the circuit — not by whether the
circuit outline lies on streets.

- `graph.ts` gained `componentOf`/`mainComponent`; `route/raster.ts`
  (12-layer orientation distance transform), `route/poseSearch.ts` (50 m/15°
  exhaustive grid, soundly pre-filtered), `route/mapMatch.ts` (closed-loop
  Viterbi), `route/pruneSpikes.ts`, `route/metrics.ts` (Fréchet, retraced
  fraction, acceptance bar), `route/escalate.ts` (the three-tier ladder), and
  `src/routes.ts` (`RouteFile`, `validateRouteFile`) — all new, all unit
  tested (69 new tests). `scripts/generate-route.ts` is a thin `tsx` CLI;
  `tsx` added as a `devDependency`.
- **Real-data result, all three bundled circuits generated and committed**
  (`src/data/routes/*.json`): hungaroring — tier 0, top route mean 20.8 m /
  max 68.1 m / length 1.124x / retrace 1.8%, passes; catalunya — tier 0, top
  route mean 22.0 m / max 80.8 m / length 1.180x / retrace 0.08%, passes;
  silverstone — escalated to **tier 2**, top route mean 29.8 m / max 95.6 m /
  length 1.148x / retrace 1.5%, passes (narrowly clears the bar the
  2026-09-20 prototype, at tier-0-only thoroughness, had missed). Generation
  times on the maintainer's machine under unusually heavy contention (system
  load average 400-800 during this run): hungaroring 167 s, catalunya 228 s
  (both tier 0 only), silverstone 1498 s across all three tiers (tier 0
  417 s, tier 1 520 s, tier 2 562 s) — every tier well inside the spec's
  15-minute budget, total well inside the 45-minute one, even under that
  load.
- **Two deliberate departures from the spec's exact plumbing**, both allowed
  by its own "contract is the pipeline, not the plumbing" provenance note:
  `pruneSpikes` is a whole-recompute-per-candidate implementation, not an
  incremental one — the spec's own named fallback ("if that design is not
  ready, ... pruning only the 3 best routes per tier") — applied via
  `escalate.ts`'s new `PRUNE_POOL` (10 candidates get the expensive pruning
  pass per tier, not every matched pose); real generation times above show
  this fallback comfortably meets the performance budget anyway. `routes.test
  .ts`'s stored-file recompute check measures length/deviation/Fréchet
  directly off each route's own stored points (exact, no graph needed) but
  re-derives `retracedFraction` by snapping points back onto the graph (the
  file doesn't store node ids) — approximate near junctions/parallel
  streets, so that one check alone uses a wider tolerance, documented in the
  test itself.
- `npm run build` and `npm run test:run` both pass (324 tests).

### Phase 23 — Routes page (look up generated routes, download GPX) — `todo`

Spec: [specs/phase-23-routes-page.md](specs/phase-23-routes-page.md). A
second static page, `routes.html`, that looks up a circuit's Phase 22
routes, draws each on a real OSM basemap next to the circuit outline, shows
plainly how well it matches (and how it misses, honestly, when it does),
and downloads it as GPX. Not yet implemented.

### Later — classified by cost and benefit (2026-09-15)

Not a commitment list — a rated menu, reassessed as real usage (and the
calendar expansion below) surfaces what actually matters. **Cost** is
implementation + verification effort at this codebase's own standard (real
data checked, not assumed); **benefit** is impact against VISION.md's actual
goal, not effort spent.

#### Recommended next (high benefit, cost paid off by the F1-calendar goal)

| Item | Cost | Benefit | Why |
| --- | --- | --- | --- |
| Full F1 calendar (~21 more circuits) via Phase 19's tool | **High** — heterogeneous: permanent circuits should be straightforward per-circuit runs of the tool; street circuits (Monaco, and likely several others — Baku, Singapore, Jeddah, Las Vegas, Miami all share Monaco's "mapped as ordinary streets, not a clean raceway relation" risk) may each need real one-off investigation, or may simply not be cleanly extractable, the same honest outcome Monaco already hit | **Highest** — this is VISION.md's opening scenario ("during the Madrid Grand Prix week, run something shaped like the Madrid circuit") and the explicit stated priority | Start with a verified list of the current season's circuits (a fresh check, not assumed from training data) and split into an easy batch (permanent/park circuits) shipped first, and a street-circuit batch tackled second, expecting some to end up documented-and-dropped like Monaco rather than forced |
| Validate Phase 6/12/14/15's tuned constants against shape diversity | **Low** — no new code, just run 2-3 deliberately extreme new circuits (a very tight one, a long sweeping one, a long-straight street one) through the existing pipeline and read the honest numbers, the same "measure, don't assume" discipline this whole matching engine was built with | **Medium-high** — every constant in `match/` was tuned only against 3 circuits in a narrow 4.3-5.9 km band; Monaco-scale (~3.3 km, tight) and Spa-scale (~7 km, sweeping) are genuinely different regimes | Fold into the *first few* circuit additions (step 3 above), not a separate phase — catches a tuning problem while only a handful of circuits are affected, not after all ~24 are in |

#### Medium-term (real value, not blocking the calendar goal)

| Item | Cost | Benefit | Why |
| --- | --- | --- | --- |
| A saved-placement "repository" (multiple named attempts per circuit) | Medium — schema version bump, a list UI | Medium, rises with circuit count — more circuits plausibly means more "which spot did I like for Spa again?" moments | Worth revisiting once the calendar makes one-slot-per-circuit feel cramped, not before |
| JSON export/import of a saved placement | Low-medium — a versioned wrapper format, import-as-copy (already scoped once, dropped from Phase 4) | Medium — hand-carrying a placement between machines/people | Pairs naturally with GPX export (Phase 18) as "get your data out of the browser," but a different format/use case, not bundled together |
| Short-lived caching of recently-computed results (search results, skeleton builds) keyed by their inputs | Low — a memoisation layer, invalidated on input change | Medium — explicitly requested (2026-09-15): avoid recomputing something just computed (e.g. re-opening the same circuit's suggestion list, rebuilding the same skeleton) | Promoted from "cheap, do opportunistically" to a real next item per direct request — see below |

#### Low priority / speculative (real cost, narrow or unclear benefit today)

| Item | Cost | Benefit | Why |
| --- | --- | --- | --- |
| Free the map (any location, pan/zoom, place search) | **High** — needs street data beyond the bundled Porto bbox first (below), plus real UI work | Low **for this product's stated scope** — VISION.md is about Porto specifically; only matters if the goal ever becomes "any city" | Don't start without an explicit scope change from the user — this is a different product shape, not a bigger version of the same one |
| Street network beyond the bundled Porto box | **High** — either a much larger bundled asset (the existing 9.5×5.3 km box is already ~575 KB gzipped-ish; a whole-city-or-bigger box could blow past the size budget that already forced a bbox reshape once) or a runtime Overpass fetch (a real architecture change — VISION.md's "no runtime OSM fetch" principle would need deliberate reconsideration, not a quiet exception) | Low unless "free the map" is actually wanted | Blocked on the same product-scope question as "free the map" — evaluate together, not separately |
| Editable circuit scale target by distance (e.g. "give me a 5 km loop even though the circuit is 7 km") | Medium — a new degree of freedom in the Phase 6 search | Low-medium — a real but niche need; most of this app's value is already in "same scale as the real thing" | Only worth it if real usage shows people actually wanting a *different* scale often, not hypothetically |
| Matching a freehand sketch / the user's own traced route against the network | Medium-high — reuses Phase 6's objective functions but is a distinct feature, its own UX | Low — unclear who this is for beyond a novelty; the corner-anchored workflow (Phase 14) already gives the user direct, guided control over a real route | Genuinely speculative; would want a concrete use case before spending the effort |

#### Superseded — remove from consideration

- **A freeform, shape-first graph search** (bending a loop street-by-street
  to fit the circuit, instead of validating poses a rigid search already
  found) — this was Phase 8's own noted fallback if its simpler approach
  proved too limited. It did (see the 2026-09-13 review), but Phase 14's
  corner-anchored, human-adjustable placement already *is* a shape-first,
  street-bending approach — just with a human doing the final adjustment
  instead of a fully automatic search. Re-attempting a fully-automatic
  version of the same idea would be re-opening a problem this codebase's own
  history (Phases 6-14) already worked through once; not worth reopening
  without a specific, evidenced reason Phase 14's result is insufficient.

## Decision log

Newest first. Each entry dated.

- **2026-09-21 — Phase 22 (route generator) implemented, real data
  generated for all three bundled circuits, every one's top route clears
  the acceptance bar.** Built the 2026-09-20 prototype's pipeline as tested,
  committed modules rather than reusing any of the deleted prototype code
  (none survived, per that entry) — this is an independent reimplementation
  against the same spec/contract, not a port, so exact numbers were expected
  to differ somewhat from the prototype's own (they came out close, and in
  silverstone's case better — see below).
  - **Stage 1 (`route/raster.ts`, `route/poseSearch.ts`).** Rasterisation
    uses an exact 2D Euclidean distance transform (Felzenszwalb & Huttenlocher,
    two 1D passes) per orientation layer, not a chamfer approximation.
    `poseSearch` runs the exhaustive 50 m/15° anchor/rotation grid itself as
    the only resolution (no further, finer grid); its "coarse" pass is a
    same-resolution pre-filter using sparser sampling (100 m vs. the real
    pass's 20 m) and a correspondingly dilated hole threshold, proven sound
    on a synthetic case (`poseSearch.test.ts`: pruned and unpruned searches
    return the identical best pose).
  - **Stage 2 (`route/mapMatch.ts`).** Closed-loop Viterbi implemented by
    trying every one of a sample's candidates at index 0 as the fixed
    start/end (at most `MATCH_CANDIDATES`, i.e. <= 16 full passes even at
    tier 2) rather than a more elaborate wrap-around DP — simple and, at
    this candidate count, cheap.
  - **Stage 3 (`route/pruneSpikes.ts`) — the one deliberate scope reduction.**
    Implemented as whole-recompute-per-candidate-removal, not the spec's
    "re-evaluate only the two affected legs" incremental design. This is the
    spec's **own named fallback** ("if that design is not ready, ... pruning
    only the 3 best routes per tier, which cuts the cost by a third with no
    change in the top result") — applied via a new `escalate.ts` constant,
    `PRUNE_POOL = 10` (only each tier's best 10 matched candidates, by their
    *unpruned* `worstRatio`, get the expensive pruning pass; the rest are
    discarded before stage 3 ever runs). Real generation times (below) show
    this comfortably meets the spec's per-tier/per-circuit budget even so —
    the incremental version remains a real future option if the pool ever
    needs to grow, not a correctness gap today.
  - **Stage 4 (`route/metrics.ts`).** Discrete Fréchet distance is the
    classic Eiter–Mannila DP, ring-start-aligned to the point nearest the
    route's own start, exactly as specified. `retracedFraction` sums, over
    every graph edge walked more than once across the whole loop, every use
    beyond the first — same idea as Phase 20's per-landmark version, applied
    to a route's `RouteLeg`s as a whole.
  - **The escalation ladder (`route/escalate.ts`)** runs the exact tier
    table the spec specifies (poses 120/240/400, match radius 90/120/150 m,
    candidates 8/12/16, prune passes 3/5/8), stopping at the first tier
    whose best candidate clears the bar or after tier 2 regardless.
  - **Real-data result — all three bundled circuits generated, all three
    top routes pass the bar**, an improvement on the prototype's own
    tier-0-only measurement (where silverstone missed):

    | Circuit | Tier | Mean dev. | Max dev. | Length ratio | Retraced | Passes |
    | --- | --- | --- | --- | --- | --- | --- |
    | hungaroring | 0 | 20.8 m | 68.1 m | 1.124x | 1.8% | yes |
    | catalunya | 0 | 22.0 m | 80.8 m | 1.180x | 0.08% | yes |
    | silverstone | 2 | 29.8 m | 95.6 m | 1.148x | 1.5% | yes (narrowly) |

    Generation ran under unusually heavy sandbox contention this session
    (system load average 400-800 on an 8-core machine, confirmed via `top`
    — a real environmental anomaly, not a code issue: the same test files
    that took 13-15 s early in the session took up to 2114 s later under
    worse contention). Even so, every tier finished well inside its 15-minute
    budget: hungaroring 167 s (tier 0 only), catalunya 228 s (tier 0 only),
    silverstone 417 s / 520 s / 562 s for tiers 0/1/2 (1498 s total, against
    a 45-minute cap). On a quiet machine this should be substantially faster.
  - **`routes.test.ts`'s recompute check** measures length, mean/max
    deviation, and Fréchet distance directly from each stored route's own
    `points` (pure geometry, no graph involved) — these matched stored
    values to within a few metres on all three files (lon/lat's 6-decimal
    storage rounding, accumulated over a several-km route). `retracedFraction`
    is the one metric that needs edge identity, which the file doesn't
    store directly; the test re-derives it by snapping each stored point
    back onto the graph, which is inherently approximate (a snap near a
    junction or between close parallel streets can land on a different node
    than the one actually walked) — measured on real data, this agreed to a
    few thousandths on two files and was off by ~0.056 on hungaroring's
    second route, so that one check alone carries a wider (0.1 absolute)
    tolerance, documented inline. A first version of this same test tried to
    rebuild the *entire* route from re-snapped node ids via `shortestPath`
    and compare lengths — found and rejected during this session: it
    diverged by up to ~390 m on a ~5 km route despite the underlying file
    being completely correct, because a re-snapped node sequence can resolve
    to a genuinely different (if similarly short) real path than the one the
    generator actually produced. Measuring geometry directly off the stored
    points, and reserving graph re-derivation for only the one metric that
    truly needs it, avoided that failure mode.
  - **First attempt at the "escalates when it must" test (`escalate.test
    .ts`) had a fixture bug, not an algorithm bug**: the synthetic street
    network only split its bottom side into two junction nodes, leaving the
    other three sides as single long edges whose midpoints sat well past
    even tier 2's 150 m match radius — so every tier failed for a reason
    unrelated to what the test meant to isolate. Fixed by splitting every
    side's midpoint except the one deliberately under test.
  - `npm run build` and `npm run test:run` pass (324 tests, up from 260).
  - **Not done, matching the spec's own scope**: nothing runs in the
    browser; Phase 23 (routes page) is next.

- **2026-09-20 — Investigated a direct user concern that Phase 6-15
  suggestions and Phase 14 skeletons don't look enough like the circuit;
  found the right metric and a pipeline that clearly beats Phase 14 on it;
  two new phases spec'd.** Four throwaway prototypes were built and deleted
  in sequence (not committed; each one's code copied to the session
  scratchpad only, likely gone; findings kept in two memory notes,
  `raster-oracle-prototype-findings.md` and `route-matching-experiment.md`):
  1. **Exhaustive raster/orientation-layer search vs. the current coarse-
     to-fine search**, permissive tolerance (35°, 20 m hole): the exhaustive
     search's top candidate beat the current search's top candidate on all
     three bundled circuits (e.g. silverstone: 70% → 83% of the outline
     within 20 m of an aligned street, longest hole 520 m → 120 m — the
     current search's top pick was hanging off the bundled bbox's edge). But
     the top-5 candidates across all three circuits landed in one 0.4-0.95
     km suburban zone, and rotation *was* discriminated there (only 1-7 of
     24 rotations scored within 25% of the best) — an earlier same-session
     claim that "any rotation fits" was checked and found wrong.
  2. **Strict tolerance (20°/12 m and 12°/10 m)**: no pose in the bundled
     bbox has zero holes at either strictness. Allowing holes up to 300 m,
     the exhaustive optimum reaches only 56-69% of the outline within 12 m —
     the honest ceiling for "circuit outline lies on streets" in Porto at
     1:1, not a search-quality problem.
  3. **Scale freedom (0.75x-1.25x)**: not the lever either. Best case
     (0.75x) gained only 0-8 points over 1.0x under strict tolerance; holes
     stayed 110-275 m at every scale tested.
  4. **The user's own proposed reframe — judge a closed running route by
     its *symmetric distance to the circuit* (both directions), not
     "outline lies on streets," in a Minecraft-style raster grid — tested
     directly and found to work.** Candidate poses (120 per circuit, from
     stage 1's exhaustive search at loose tolerance) were each resolved into
     a real route by a **closed-loop Viterbi map match** over the street
     graph (jointly choosing every waypoint, unlike Phase 14's
     `resolveLandmark`, which the Phase 21 rejection diagnosed as exactly
     the missing piece), then cleaned by greedy spike removal. Measured
     against the **full** circuit centreline (Phase 14's own comparison used
     only its corner polygon, which flatters its numbers), the best route
     beat the best of the current search's top-5 skeletons on every circuit:
     hungaroring mean deviation 42→22 m, max 236→76 m, length ratio
     1.02x→1.13x, retraced 5%→2%; catalunya 54→22 m, 198→88 m,
     1.10x→1.19x, 12%→2%; silverstone 87→33 m, 294→128 m,
     1.17x→1.24x, 21%→1%. Against a provisional bar (mean ≤30 m, max
     ≤100 m, length 0.9-1.2x, retrace ≤5%, accepted by the user without
     independently validating the numbers) hungaroring and catalunya pass,
     silverstone misses narrowly. Match parameters were tuned only on a
     12-combination sweep against hungaroring's 12 candidate poses and
     applied unchanged to the other two circuits — held on catalunya, less
     well on silverstone. Six generated-route images (three circuits × old
     vs. new) were rendered and shown to the user in a private artifact for
     visual confirmation before any of this was written up. Two caveats the
     user has not yet weighed in on: spike pruning cost ~40 minutes per
     circuit as prototyped (naive whole-route recompute per candidate
     removal, machine under heavy load) — a real version needs incremental
     local evaluation, scoped explicitly in
     [specs/phase-22-route-generator.md](specs/phase-22-route-generator.md);
     and the street set used includes footways/paths/steps, so "runnable"
     is not yet filtered.
  **Decision, per the user's explicit request**: build this as a real
  feature, not another throwaway. Two phases spec'd:
  [specs/phase-22-route-generator.md](specs/phase-22-route-generator.md)
  (the pipeline above as tested modules in `src/route/`, plus a dev-only
  `npm run generate-route -- <circuitId>` script — nothing runs in the
  browser, output is committed JSON per circuit) and
  [specs/phase-23-routes-page.md](specs/phase-23-routes-page.md) (a new,
  separate static page, `routes.html`, that looks up a circuit's generated
  routes on a real basemap next to the circuit outline and offers a GPX
  download — kept separate from the existing suggestion/skeleton page
  because the two pages embody different ideas of "match" and the existing
  one is a tool while this one is a lookup). `StreetGraph` needs a
  `componentOf`/`mainComponent` addition (scoped in Phase 22): the
  prototype found `A*` pathologically slow toward nodes in a different,
  disconnected component (measured 2026-09-20: the real network's main
  component holds 34 474 of 37 653 nodes, 91.6%, across 1 313 components,
  the next largest just 42 nodes) — restricting match candidates to the
  main component brought 12-pose matching from minutes to 3 s. "Current
  priority" reordered: Phase 22/23 now precede Phase 18/19 (GPX export is
  needed sooner, by Phase 23, than by its own original UI; Phase 19's
  circuit-extraction tooling still gates the full calendar but is not
  blocking this). The existing Phase 6-15 suggestion flow and Phase 14
  skeleton are untouched and keep working; retiring any of them is an
  explicit later decision, not part of this one.

- **2026-09-15 — Phase 21 rejected: the sketched local repair pass was
  prototyped, measured against real data, and found to structurally never
  change anything — not implemented.** Followed the discipline the spec
  itself demanded: prototype before committing, measure, and say so
  honestly if it doesn't help. Implemented exactly the spec's recommended
  approach — for each landmark with `retraceM > 0`, re-run
  `nearestAlignedPointM` excluding every edge id used by the loop's *other*
  legs (not the two touching this landmark), and move it there via the
  existing `moveLandmark` if a different node came back — plus the one
  `StreetGraph` addition it needed (`excludeEdgeIds` on
  `nearestAlignedPointM`). Measured before/after `retracedM` for all three
  bundled circuits' top candidates: **zero change, bit-for-bit** —
  hungaroring 1434 m, silverstone 361 m, catalunya 860 m, identical before
  and after a bounded 3-pass repair sweep. Diagnosed why, not just that:
  logged every landmark's own current node against what the
  exclusion-aware search returned for hungaroring (10 landmarks) and
  catalunya (9, including the flagged non-adjacent 2↔6 pair) — **all 19**
  came back at `distanceM = 0`, the landmark's own existing point, every
  time. The reason is structural, not incidental: a landmark's
  currently-resolved point is *by definition* on an edge that became part
  of one of its own two touching legs (that's what "resolved" means — the
  best-aligned point, which then gets routed to/from its neighbours) — so
  under "exclude every edge used by legs other than mine," that point can
  never be excluded, and a plain nearest-match search re-finds the exact
  same already-globally-nearest point every single time. The design
  cannot ever move a landmark, on any circuit, not merely "didn't help on
  these three." A repair that could actually work would need to look
  further than the landmark's own immediate best match — e.g. resolving
  landmarks with some awareness of neighbours' claims *during* `buildLoop`
  itself, rather than post-hoc local re-search after the fact — a real
  redesign of `resolveLandmark`, not a bounded local patch, and exactly the
  "much bigger, riskier idea" the spec itself said not to reach for without
  first confirming the local version wasn't enough. It demonstrably isn't;
  no such redesign is scoped or planned. All prototype code (the
  `excludeEdgeIds` graph addition, `repairLandmark`/`repairSkeletonLoop`,
  and the measurement test) was added, run, and then fully removed — not
  merged — per this project's own rule against shipping code that doesn't
  work. `docs/specs/phase-21-avoid-skeleton-backtracking.md` marked
  `rejected` with this finding recorded at the top; the original sketch
  kept below it as the historical record of what was tried. "Current
  priority" moves on to Phase 18 (gpx export); Phase 19 (and the calendar
  batch after it) no longer wait on 21, since Phase 20 alone already gives
  new circuits' skeletons honest labelling.

- **2026-09-15 — Phase 20 shipped: skeletons now expose and display
  retraced (backtracked) length, per loop and per landmark.** Implements
  [specs/phase-20-detect-skeleton-backtracking.md](specs/phase-20-detect-skeleton-backtracking.md),
  closing the visibility gap the same-day investigation below found.
  `RouteLeg` (`app/trace.ts`) gains `edgeIds`, threaded through from
  `graph.shortestPath` (already computed, previously discarded by
  `joinWaypoints`). `match/landmarks.ts`'s new `computeRetraced` sums, for
  every edge id used by more than one leg in the loop, every use beyond the
  first — an honest "retraced, not new ground" total (`SkeletonLoop
  .retracedM`) — and splits each shared edge's length evenly across every
  leg that walks it, then evenly again across the two landmarks bounding
  each leg (`LandmarkAnchor.retraceM`), so there is no arbitrary "which use
  was the retrace" choice on a loop that has no natural start. One
  deliberate deviation from the spec's suggested plumbing: rather than
  reconstructing per-edge length from a leg's own points (geometrically
  fragile — a leg's points carry no recoverable per-edge boundary once
  `shortestPath` has concatenated them), `StreetGraph` gained one new
  method, `edgeLengthM(edgeId)` — a trivial, exact lookup into data the
  graph already holds privately, versus a heuristic that would have to
  guess edge boundaries from geometry. The spec's own contract note
  ("the contract is the formula above, not the exact plumbing") covers this
  choice. Real figures for the three bundled circuits' top candidates,
  confirming the investigation's finding stays detected: hungaroring 1434 m
  retraced of 6149 m (23%, all 10 landmarks flagged — matches the earlier
  10-of-10 adjacent-pair finding), silverstone 361 m of 6084 m, catalunya
  860 m of 5135 m. Verified in the browser against Hungaroring's own top
  suggested placement: the summary reads "10 corners · 6.15 km (1.43 km
  retraced) · 0 gaps" and every landmark marker renders in the new amber
  `skeleton-marker--retrace` style. Phase 21 (automatic avoidance) was
  prototyped against these same numbers immediately after — see the entry
  above, dated the same day: it doesn't work, and was rejected rather than
  shipped. "Current priority" moved to Phase 18 (gpx export), the next
  locked, ready spec.

- **2026-09-15 — Investigated: Phase 14 skeletons can hide a "comb"
  backtracking pattern behind honest-looking numbers. Two specs written,
  one flagged as needing prototyping before it's real.** Prompted by a
  direct, precisely-reasoned user report: if a circuit's finish straight
  were placed perpendicular across many closely-spaced parallel streets that
  never touch, each sample point would find *some* nearby well-aligned
  street, scoring high coverage — "só que não conseguia correr." Checked
  whether Phase 14's landmark-based skeletons have the equivalent problem by
  capturing `shortestPath`'s already-computed `edgeIds` (currently discarded
  by `joinWaypoints`) for every leg of the three bundled circuits' top
  candidate and checking for reuse across legs. **Confirmed, severely**:
  hungaroring's top skeleton (10 corners) overlaps on **10 of 10** possible
  adjacent leg pairs, up to 23 shared edges between two legs alone;
  silverstone 3 of 7 pairs; catalunya 5 of 8, including two *non-adjacent*
  legs sharing 36 edges. This is the same failure Phase 8's `RoutedLoop
  .simple` flag existed to catch and report ("never rejected on its own,
  only reported") — Phase 14 never re-added an equivalent when it replaced
  Phase 8's mechanism, so today's skeleton summary ("10 corners · 6.15 km ·
  0 gaps") gives no hint this is happening, breaking Phase 14's own design
  promise ("the computer flags the 2-3 points that need fixing") since
  nothing currently points at which corner is the problem.
  Root cause: `resolveLandmark` picks each landmark's best real street
  **independently**, unaware of what an adjacent landmark already claimed —
  structurally the same class of problem Phase 11 solved for the old
  60-sample system, recurring at the landmark level because nothing
  equivalent was carried forward.
  Decision: split the fix into visibility (real, scoped, spec'd now) and
  avoidance (sketched, explicitly *not* locked, since — per this session's
  own established discipline after three disproved tuning hypotheses on
  2026-09-14 — an unvalidated algorithmic fix should not be spec'd with false
  confidence).
  [specs/phase-20-detect-skeleton-backtracking.md](specs/phase-20-detect-skeleton-backtracking.md)
  adds `retracedM`/`retraceM` (total and per-landmark retraced length,
  computed from `edgeIds` overlap) and a third marker style so the user can
  see and drag exactly the right corner.
  [specs/phase-21-avoid-skeleton-backtracking.md](specs/phase-21-avoid-skeleton-backtracking.md)
  sketches a bounded local repair pass (re-resolve a retracing landmark
  excluding edges its neighbours already used) but is explicit that this
  needs prototyping against hungaroring's worst case before it's trustworthy
  — `StreetGraph` has no "search excluding these edges" primitive yet, and
  whether local re-resolution actually finds a better street (versus the
  overlap being the *only* real option in a dense grid) is an open, testable
  question, not assumed.
  "Current priority" reordered: Phase 20 now precedes the F1-calendar work
  (Phase 18/19) — batch-adding ~21 more circuits onto an undisclosed
  correctness problem would scale it 8×, not just add content.
  Also per direct request this session: removed "auto-select the circuit for
  the current race weekend" from the roadmap (not wanted); confirmed "free
  the map" / street data beyond Porto stays out of scope (no city-expansion
  intent for now, consistent with their existing "blocked on an explicit
  scope change" classification); promoted short-lived result caching
  (search results, skeleton builds) from an opportunistic nice-to-have to a
  real classified item — avoid recomputing something just computed.
  All investigation (the throwaway `edgeIds`-overlap check) was run and
  discarded, not committed.

- **2026-09-15 — Phase 17 shipped: Pages source corrected, permanent
  post-deploy smoke check added.** Implements
  [specs/phase-17-harden-deploy-pipeline.md](specs/phase-17-harden-deploy-pipeline.md)
  as written, no scope changes. **Step 1**: the repository's Settings →
  Pages → Source was corrected to "GitHub Actions" — done directly by the
  maintainer, confirmed to this session verbally, since no tool available to
  this session has the repository-admin access needed to read or change that
  setting itself. This is the actual root fix for "the live site serves raw
  source instead of the deployed app" found in the 2026-09-15 investigation.
  **Step 2**: `.github/workflows/deploy.yml`'s `deploy` job gained one new
  step, "Verify the deployed site is the built app, not raw source", right
  after the existing `actions/deploy-pages@v4` step — fetches
  `steps.deployment.outputs.page_url` and fails the job (`::error::` +
  `exit 1`) if the body contains the literal `/src/main.ts` (raw-source
  signature) or lacks a `/circuit-finder/assets/*.js` reference. The asset
  pattern was checked against a real local `npm run build`'s
  `dist/index.html` before finalising (per the spec's explicit instruction
  not to guess it) — Vite emits exactly `/circuit-finder/assets/index-
  <hash>.js` and `.css`, confirming the sketch's pattern needed no
  adjustment. No change to the `build` job or any application file. **Guard
  rail verified both directions, the same discipline Phase 9's crossing-
  detection tests already apply to application code**: ran the check's exact
  shell logic locally against a synthetic raw-source HTML body (caught,
  fails as designed, same `::error::` message) and against the real
  `dist/index.html` from a clean build (passes, no false positive) — the
  spec's own "regression check, deliberately run once" requirement, done as
  a local simulation rather than a live scratch deploy since no CI trigger
  was available mid-session. YAML validity of the edited workflow confirmed
  (`ruby -ryaml`, since neither `js-yaml` nor Python's `yaml` module was
  available in this environment) — structure parses correctly, `deploy`
  job's `steps` array has exactly the original `deployment` step plus the
  one new step. The workflow's actual live-deploy behaviour (does the new
  step run and pass against a real GitHub Pages deployment) is confirmed by
  the next push to `main`, not by this local simulation alone — see
  *Acceptance criteria* in the spec.

- **2026-09-15 — Phase 16 shipped: shared graph fixture + real timeouts for
  the flaky real-data tests, implemented as written, no scope changes.**
  `src/app/map.ts`'s `createMapApp` gained an optional fourth `MapAppDeps`
  parameter (`network`/`streetIndex`/`streetGraph`, each defaulting to
  building itself via `??` exactly as before when omitted) — `main.ts`, the
  one production call site, passes no `deps` and is unaffected, confirmed by
  the diff touching only `map.ts`/`map.test.ts`/`graph.test.ts`.
  `src/app/map.test.ts` now builds `network`/`streetIndex`/`streetGraph`
  once in a module-level `beforeAll` and passes them via `deps` at all 18
  `createMapApp(...)` call sites; every one of its five top-level `describe`
  blocks got `{ timeout: 15_000 }` (propagates to nested `it`s, per Vitest's
  `SuiteOptions extends TestOptions`) instead of the 5000 ms global default.
  `src/graph.test.ts`'s real-data connectivity test got an explicit `30_000`
  third-argument timeout. No assertion's expected behaviour changed in
  either file — confirmed by diffing against `git show HEAD:...` copies of
  both files before editing.
  **Real-data result:** `app/map.test.ts` alone, measured directly (ran the
  pre-fix file under a throwaway copy, not from memory): Vitest's own
  reported Duration dropped **48.54 s → 10.28 s**, wall-clock `time`
  **~50.2 s → ~12.2 s** — in line with the spec's "~49 s of redundant work"
  estimate from the measured ~2.9 s single-build cost × 17 avoidable rebuilds.
  Verified under the same contention profile that broke GitHub's own runner:
  two consecutive full-suite runs at `npx vitest run --maxWorkers=2`
  (approximating a 2-vCPU GitHub Actions runner) both passed **284/284, zero
  timeouts** (27.81 s then 25.20 s) — previously this exact command was where
  the Phase 15 push failed on CI. `npm run build` and `npm run test:run`
  (default config) both clean, 284/284. No change to `buildStreetGraph`'s own
  algorithm, to Vitest's global `testTimeout`/`pool`/`isolate` config, or to
  any other test file's fixture sharing (`match/search.test.ts` already
  builds its own network/index once per file, the correct granularity) — all
  three explicitly out of scope per the spec. Full spec:
  [specs/phase-16-fix-flaky-real-data-tests.md](specs/phase-16-fix-flaky-real-data-tests.md).
  Current priority moves to
  [specs/phase-17-harden-deploy-pipeline.md](specs/phase-17-harden-deploy-pipeline.md)
  — the deploy pipeline can now trust its own test gate.

- **2026-09-15 — Investigated: the published site is broken, not just
  outdated. Two causes found, two specs written.** Prompted by a direct
  report ("I don't see the differences on GitHub"). Checked git first
  (`git fetch` + `rev-parse`): local `HEAD` and `origin/main` were identical
  (`65d12a1`, Phase 15) — every commit and doc file was genuinely pushed, so
  the report pointed somewhere else. Traced it to the published GitHub Pages
  site (`https://www.jnvasconcelos.com/circuit-finder/`, the repo's custom
  domain): fetched it directly and found `index.html` **byte-identical to the
  repo's own source `index.html`**, referencing `<script src="/src/main.ts">`
  — raw TypeScript, served by GitHub as `content-type: video/mp2t`, which no
  browser can execute as a module; `/circuit-finder/assets/` (where a real
  Vite build's output lives) returned `404`. **The live site has not been
  running a built application since Phase 12's push (2026-09-12) — the last
  time the real deploy step succeeded** — not merely stale.
  **Cause 1**: the GitHub Actions API (public, unauthenticated) showed the
  `CI + Pages` workflow's one run for the Phase 15 push (`65d12a1`) failed at
  `npm run test:run`, correctly skipping `npm run build` and the deploy step
  — exactly the known "flaky under load" test pattern noted in every decision
  log entry since Phase 10, now confirmed to have a real consequence on
  GitHub's own (2-vCPU) runner, not just this session's heavily-loaded
  machine. Full investigation and fix:
  [specs/phase-16-fix-flaky-real-data-tests.md](specs/phase-16-fix-flaky-real-data-tests.md).
  **Cause 2, separate and worse**: despite that deploy being correctly
  skipped, the live site changed anyway roughly 10 minutes later (`last-
  modified` on the live response matches a `pages build and deployment`
  system-generated run for the same commit that succeeded unconditionally,
  distinct from the repo's own `CI + Pages` workflow) — strong evidence the
  repository's **Pages source setting is "Deploy from a branch"** rather than
  "GitHub Actions", so GitHub publishes the raw branch content on every push
  regardless of whether the real build ever runs or passes. Confirmed the
  `GET /repos/.../pages` API returns `404` (consistent with, though not
  conclusive proof of, a non-Actions source — full confirmation needs
  repository-admin access this investigation didn't have). Fix: correct the
  setting (one-time, manual — no code change makes GitHub stop doing this on
  its own) plus a permanent, automated post-deploy smoke check so a repeat
  (this cause or a different one) fails the workflow loudly instead of
  silently serving broken content again. Full plan:
  [specs/phase-17-harden-deploy-pipeline.md](specs/phase-17-harden-deploy-pipeline.md).
  All investigation (API queries, live-site fetches, a throwaway timing
  script measuring `buildStreetGraph` at ~2.9 s for the full 26 994-way,
  37 653-node bundled network) was read-only / run-and-discarded, not
  committed.

- **2026-09-14 — Phase 15 shipped: spatial-quota coarse search, implemented
  as written, no scope changes.** `match/types.ts` gains
  `SearchOptions.spreadCellM` (default `2000`, `DEFAULT_SEARCH_OPTIONS` in
  `match/search.ts`). `search.ts`'s coarse-keep step — previously `coarse
  .sort((a, b) => b.score.score - a.score.score); const kept =
  coarse.slice(0, o.coarseKeep)` — now buckets every scored `coarse`
  candidate (grid sweep and Phase 12's straight-anchored seeds, unchanged
  merged array, no separate code path) by `floor(anchorM / spreadCellM)`,
  keeps only each occupied macro-cell's best-scoring candidate in a `Map`,
  then sorts those macro-cell winners by score and takes the top
  `coarseKeep`. An occupied cell always keeps its one winner; an empty cell
  contributes nothing; a cell already represented is never given a second
  slot even if `coarseKeep` isn't exhausted — exactly the spec's sketch, no
  changes needed during implementation. No change to `objective.ts`,
  `straights.ts`, `graph.ts`, `streets.ts`, `app/map.ts`, or `ui/controls.ts`
  — confirmed by re-reading the spec's "Repository layout after this phase"
  list before starting, and by the diff touching only `types.ts`/`search.ts`.
  **Real-data result** (measured via a new diagnostic-only helper in
  `search.test.ts` that reproduces the same coarse pool `searchPlacements`
  itself just scored, purely to compare old vs. new selection on identical
  data — not a second production code path): occupied macro-cells vs. what
  today's flat top-16 reached vs. what spatial-quota reaches (same
  `coarseKeep = 16` budget) — **hungaroring 17 occupied → flat reached 3,
  spatial-quota reaches 16; silverstone 13 occupied → flat reached 4,
  spatial-quota reaches all 13; catalunya 16 occupied → flat reached only 1,
  spatial-quota reaches all 16.** These land close to the spec's own
  investigation numbers (13-16 occupied regions, 3-4 reached) — catalunya's
  flat-selection number (1, not 3-4) is even more concentrated than the
  spec's estimate, an honest real number rather than one adjusted to fit the
  prediction. The final 5-suggestion result list (post-refine/dedup/Phase
  12's diversity pass) now occupies 5 distinct macro-cells for every bundled
  circuit, and the maximum pairwise distance between final accepted anchors
  grew to **hungaroring 6744 m, silverstone 4826 m, catalunya 6482 m** (up
  from Phase 12's 4687/5449/1057 m — catalunya's jump from 1057 m to 6482 m
  is the largest relative change, consistent with it having gone from 1
  reachable macro-cell to 16). `npm run dev` spot-check: running **Suggest
  placements** independently for each bundled circuit (no other circuit
  touched first) showed candidate markers spread across visibly different
  parts of the bundled bbox rather than one neighbourhood's variations,
  matching the numbers above.
  **One pre-existing Phase 12 test needed updating, not the production
  code:** `search.test.ts`'s "diversity in final selection" suite had a
  "crowded cluster" fixture (three anchors 300-424 m apart, deliberately
  closer than `diversityDistM` to exercise Phase 12's two-pass accept) that,
  under a 2000 m `spreadCellM`, now collapses into a single macro-cell —
  spatial-quota keep lets only that cell's one best-scoring candidate ever
  reach refine, so Phase 12's diversity pass never gets multiple candidates
  from that area to work with in the first place. This is the explicit,
  spec'd trade-off ("never padded with a second candidate from an
  already-represented cell, since that would silently reintroduce today's
  concentration") — the test now asserts the honest new outcome (1
  suggestion returned, not padded to `resultCount`) instead of the
  pre-Phase-15 expectation. 5 new tests added (regression guard reproducing
  what flat top-`coarseKeep` used to do on a synthetic dense-cluster-vs.
  -scattered-cells fixture; single-candidate and empty macro-cells;
  fewer-occupied-cells-than-`coarseKeep`; a straight-anchored seed becoming
  its own otherwise-empty cell's winner). 284 tests pass (`npm run build`
  clean); the same load-sensitive timeouts noted in every prior phase's
  entry (`graph.test.ts`'s real-data connectivity check, several
  `app/map.test.ts` cases) appeared under this session's full-parallel
  `npm run test:run` and passed cleanly re-run in isolation (`npx vitest run
  src/graph.test.ts src/app/map.test.ts`, 35/35) — not a Phase 15
  regression. Full spec:
  [specs/phase-15-spatial-quota-search.md](specs/phase-15-spatial-quota-search.md).

- **2026-09-14 — Investigated: Suggest placements' top pick converges on the
  same neighbourhood across different circuits; three tuning hypotheses
  disproved, one design rejected on product direction, before landing on the
  real fix.** Prompted by direct user observation comparing
  Hungaroring/Silverstone/Catalunya's top suggestions. Measured first, before
  guessing: the three circuits' top-ranked anchors sit **338-786 m apart** —
  all in Aldoar/Boavista near Parque da Cidade.
  **Round 1 (score under-weights shape vs. coverage) — disproved:** reran the
  search at `wTurning`/`wProcrustes` up to **16×** shipped value; cross-circuit
  distance moved only to 96-626 m, no consistent improvement.
  **Round 2 (coarseKeep truncates before diversity has candidates to choose
  from) — disproved:** a full coarse-grid scan (throwaway script, not
  committed) found 146-159 cells clearing `MIN_COVERAGE`, spread across
  8.7 km of the 9.5 km bbox — genuine geographic diversity of *viable*
  candidates already exists — but reran the search at `coarseKeep` up to
  **256** (16×, 52 s vs 7 s for three circuits) and the top pick still
  converged to the same neighbourhood.
  **Round 3 (raise Phase 12's own `diversityDistM`) — disproved, and
  counterproductive:** raising it made within-circuit spread measurably
  *worse* (hungaroring: 4687 m spread at the shipped 800 m down to a flat
  800 m at `diversityDistM ≥ 4000`). Mechanism found: the two-pass accept's
  first pass requires distance from *every* already-accepted candidate at
  once, so a large threshold empties that pass out almost immediately after
  the first pick, and the rest fall through to the second pass's plain-score
  fallback (no distance constraint at all) — which just refills from the same
  favoured neighbourhood.
  **First fix draft — session memory of other circuits' claimed
  placements — rejected on explicit product direction**: the search must
  treat every circuit identically and statelessly, with no per-circuit rules,
  so the fix keeps working unchanged as more circuits are added later.
  **Actual cause, confirmed directly**: bucketing the same coarse-scored
  candidates from Round 2 into ~2 km macro-cells found **13-16 distinct
  regions of the bundled bbox with at least one viable candidate**, for every
  circuit — but today's flat "top 16 by score" `coarseKeep` selection
  **occupies only 3-4 of those 13-16 regions**, every time: one
  neighbourhood's own internal variation (different sub-cells, different
  rotations within the same ~1.5-2 km area) is enough to fill most or all of
  the 16 slots before most other regions' candidates are ever considered —
  a selection-step bug, not a scoring, search-width, or spread-threshold one,
  and one Phase 12's diversity pass structurally cannot see past, since it
  only ever operates on whatever narrow pool survives this much earlier cut.
  Decision: replace flat top-`coarseKeep` with one-winner-per-macro-cell
  selection (at most one candidate per ~2 km cell reaches refine, ranked
  cells capped at the existing `coarseKeep` budget) — pure, stateless, no
  circuit identity anywhere in the mechanism, unaffected by how many circuits
  exist. Full plan:
  [specs/phase-15-spatial-quota-search.md](specs/phase-15-spatial-quota-search.md).

- **2026-09-14 — Phase 14 shipped: corner-anchored, human-adjustable
  placement.** Implements
  [specs/phase-14-corner-anchored-placement.md](specs/phase-14-corner-anchored-placement.md)
  as written, no scope changes. `geometry/corners.ts` (new): `extractCorners`
  walks a closed path's joint turn angles — sharing `straight.ts`'s
  `buildSegments`/`turn` (now exported for this, per the spec's "share, don't
  duplicate" note) rather than reimplementing the segment-direction
  machinery — keeps every joint whose turn exceeds `minTurnRad` (0.35 rad,
  ~20°), then repeatedly merges the closest circularly-adjacent pair of
  surviving corners while under `minSpacingM` (60 m), keeping the sharper of
  the two, until nothing is close enough left to merge. `match/landmarks.ts`
  (new): `buildLandmarks` turns a circuit's corners into `Landmark`s (corner +
  local heading, reusing `objective.ts`'s `localHeading` so a landmark's
  heading is computed exactly the way every other phase's alignment checks
  already are); `resolveLandmark` places one landmark under a candidate pose
  and searches `StreetGraph.nearestAlignedPointM` within
  `LANDMARK_SEARCH_RADIUS_M` (120 m — 4× the old rigid-loop
  `LOOP_SNAP_MAX_M`, since there are far fewer points to place and each one
  matters more); `buildSkeletonLoop` resolves every landmark and joins them
  leg by leg via `app/trace.ts`'s existing `joinWaypoints` (unchanged); `SkeletonLoop`
  also carries `placedRingM` (the candidate-placed, unsnapped corner ring) —
  one field beyond the spec's original type sketch, added so `moveLandmark`
  can recompute a moved corner's two legs and the loop's totals without
  needing the placement (candidate/scale) a second time, since a resolved
  anchor's exact street point and an unresolved one's fallback position are
  otherwise unrecoverable from the anchor list alone. `moveLandmark` replaces
  one anchor, re-joins only its two adjacent legs (every other leg object in
  the returned loop is the *same reference* as before — verified by a
  dedicated test — so a drag never re-runs `shortestPath` on legs it didn't
  touch), and recomputes `lengthM`/deviation/`gapCount` from the merged leg
  list, which is cheap arithmetic, not a graph search. `app/state.ts` gained
  the trivial `setRoute` reducer. `app/map.ts`: `onBuildSkeleton` builds a
  skeleton from the live placement; a `L.marker` per anchor (purple ring,
  red ring when unresolved) is draggable, snapping on `dragend` via the same
  `streetGraph.nearestPointM(_, SNAP_MAX_M)` trace mode already uses, calling
  `moveLandmark` — a drop with nothing in range still moves the marker with
  `node: null`, an honest new gap, never a silently-rejected drag;
  `onCommitSkeleton` flattens the skeleton's legs (de-duplicating the shared
  point at each leg boundary) into `state.route` via `setRoute` and discards
  the skeleton, after which it behaves exactly like a hand-traced route,
  measured/saved/exported with no schema change; `onDismissSkeleton` discards
  it untouched. Building, using a suggestion, or previewing a suggestion each
  clear the other's transient UI (skeleton ⟷ suggestion preview), mirroring
  the existing `previewingSaved` mutual-exclusion pattern. `ui/controls.ts`
  gained a "Find corner anchors" section (idle button; built: "N corners ·
  X.XX km · N gaps" plus **Use as route**/**Dismiss**), between "Suggest
  placements" and "Route". No change to `graph.ts`, `streets.ts`,
  `app/proximity.ts`, `match/search.ts`, `match/straights.ts`,
  `match/objective.ts`, or `placements.ts` — this phase composes existing,
  already-correct infrastructure, per the spec's explicit instruction not to
  resurrect any part of the deleted rigid-pose `match/loopSearch.ts`
  (confirmed: nothing in the new code imports from or references the deleted
  module's types or functions).
  **Constants tuned against the three bundled circuits** (a throwaway sweep
  script, run and discarded, not committed): the spec's starting values
  (`MIN_TURN_RAD` 0.35, `MIN_CORNER_SPACING_M` 60, `LANDMARK_SEARCH_RADIUS_M`
  120) already came out best among everything tried. Coarser thresholds
  (fewer, more merged corners) consistently made the skeleton *undershoot*
  the circuit's real length (ratios as low as 0.48-0.75×) by cutting real
  corners off the shape entirely, not just simplifying it; finer thresholds
  (more corners) consistently raised both the length ratio and the gap count,
  since more, closer-together landmarks means more independent chances for a
  street-alignment or connectivity miss. Widening
  `LANDMARK_SEARCH_RADIUS_M` (120 → 250 m) changed nothing at all for any
  bundled circuit — confirming (as Phase 8/9's investigation found for the
  old rigid loop) that gaps here come from real street disconnection, not
  from the search radius being too tight. Shipped at the spec's original
  values, unchanged.
  **Real-data result — the number the spec's acceptance bar is judged
  against:** at the best Phase 6/12 candidate placement, before any manual
  dragging — hungaroring: 10 corners, 1.41× real length, 0 gaps; silverstone:
  8 corners, 1.00×, 4 gaps; catalunya: 9 corners, 1.00×, 2 gaps. Against the
  spec's bar (under 1.2× *and* under 4 gaps, on at least two of three
  circuits): **only catalunya clears both.** Silverstone clears the length
  half but not the gap half (4 gaps is not *under* 4); hungaroring clears
  neither (though its 0 gaps mean everything it did resolve connects, just
  via a longer real detour than a straight corner-to-corner line would
  suggest — a routing-shape mismatch, not a connectivity failure). Shipped
  anyway, per the spec's own explicit instruction to ship and record the
  honest number rather than adjust the bar to declare victory — the
  drag-to-adjust interaction is the actual point, and an imperfect automatic
  starting skeleton is still a real, nameable improvement over both the
  deleted best-effort loop (1.43-2.24×, 10-29 gaps) and an unaided blank map.
  279 tests pass (up from 253 before this phase; `npm run build` clean).
  Under this session's heavy concurrent machine load, a full parallel
  `npm run test:run` showed 9 timeouts across `graph.test.ts`,
  `match/search.test.ts`, `app/map.test.ts`, and this phase's own
  `match/landmarks.test.ts` real-data case — every one a default-timeout
  artifact (several took 500-600 s under load, including cases unrelated to
  this phase, like `graph.test.ts`'s pre-existing connectivity check), never
  a logic failure, and every one passed cleanly re-run in isolation on a
  quiet machine — the same known resource-profile characteristic noted in
  the Phase 10/12/13 decision log entries, not a regression from this
  phase's changes.

- **2026-09-13 — Phase 13 shipped: `match/loopSearch.ts` deleted, Suggest
  placements back to an honest coverage list.** Directly implements the
  same-day review's remediation plan (previous entry). `src/match/loopSearch.ts`
  and `loopSearch.test.ts` are deleted outright; `RoutedLoop`, `BestEffortLoop`,
  `RoutedSuggestion`, `LoopSearchProgress`, `LoopSearchOptions` are gone from
  `match/types.ts`. `app/suggest.ts` drops `createLoopSuggester`/`LoopSuggester`
  (`pump`, `createSuggester`, `Suggester` untouched — they were already tested
  and now cover the app's real path again). `app/map.ts` switches from
  `createLoopSuggester()` to `createSuggester()`: `onSuggest`'s search call
  drops the `streetGraph` argument and the `phase: 'search' | 'route'`
  distinction; `onUseSuggestion` sets only `applyPlacement(state,
  chosen.placement)`, no longer seeding a route from `chosen.loop?.points ??
  chosen.bestEffort?.points`; the hovered-suggestion preview drops
  `previewRouteLine`/`previewGapLine` entirely and falls back to the existing
  dashed-outline mechanism the saved-placement preview already used pre-Phase-8
  (`GAP_COLOR`/`routeGapLine` stay — manual tracing's gap rendering is
  unrelated and unaffected). `ui/controls.ts`'s `SuggestView.suggestions`
  becomes `readonly Suggestion[]`, `formatSuggestionLabel` drops the
  `s.loop`/`s.bestEffort` branches back to the single coverage-percentage
  line, and the running-phase label is unconditionally "Searching
  placements…" (`SearchProgress` has no `phase` field to branch on). No change
  to `match/search.ts`, `match/straights.ts`, `match/objective.ts`, `graph.ts`,
  or any Phase 6/12 constant — this phase only changed what `app/map.ts` calls
  and what `ui/controls.ts` renders. `grep -r "RoutedSuggestion\|RoutedLoop\|
  BestEffortLoop\|createLoopSuggester" src/` returns nothing. 253 tests pass
  (`npm run build` clean); the same two real-data tests noted as
  load-sensitive in the Phase 10/12 decision log entries (`graph.test.ts`'s
  connectivity check, several `app/map.test.ts` cases) timed out under this
  session's full-parallel run and passed cleanly re-run in isolation — the
  same known resource-profile characteristic, not a regression from this
  phase's changes. Full spec: `docs/specs/phase-13-honest-suggestions.md`.

- **2026-09-13 — Independent code review: the routed/best-effort loop
  approach doesn't work, and can't be tuned into working.** Requested
  explicitly as a code-only review (not a review of process or past
  decisions). Findings, verified first-hand (re-ran the real-data test in
  isolation; drove the live app in a headless browser and inspected the
  rendered result, not just the numbers): **0 of 15 suggestions (5 per
  circuit × 3 bundled circuits) form a real closed loop, on every run.**
  Every suggestion falls back to a best-effort loop 1.43-2.24× the circuit's
  real length, with 17-48% of its 60 samples unresolved and drawn as straight
  invented segments — visually, a tangled scribble confined to one small
  neighbourhood, not the source circuit's shape (screenshots in the review).
  One inspected gap-adjacent leg threaded through a school's internal
  grounds — nothing in `graph.ts`/`match/loopSearch.ts` distinguishes a
  public street from a path inside a private/institutional compound. Root
  cause: `match/search.ts` searches a *rigid* translation+rotation of the
  circuit's undeformed outline, and `match/loopSearch.ts` then tries to
  validate or patch a real street loop under that same rigid, undeformed
  shape — real organic street grids have no reason to contain an undistorted
  copy of a purpose-built racing circuit, so this only works by luck, and it
  never has across three different circuit shapes. Phases 7-12's own honest
  tuning history is itself the evidence this is a diminishing-returns ceiling
  for the chosen strategy, not a "nearly there" situation: six phases moved
  the best-case length ratio from ~2.15-3.6× down to 1.43-2.24× while
  `routedCount` stayed at exactly 0 throughout every single one. What *does*
  work, confirmed correct and unaffected by this finding: `geometry/*`
  (transform/straight/turning/procrustes), `graph.ts`'s connectivity repair
  and A*, `streets.ts`/`app/proximity.ts`'s index and heatmap, and manual
  tracing (`app/trace.ts`, Phase 5/7) — the one workflow that already keeps
  both real scale and a recognisable shape, because it keeps the user's
  judgement in the loop instead of trying to fully automate a search a rigid
  model can't solve. Full report, evidence, and a two-phase remediation plan
  (drop the false claim, then replace it with a fundamentally different
  approach — not more tuning of the same one) in
  [reviews/2026-09-13-suggested-placements-review.md](reviews/2026-09-13-suggested-placements-review.md);
  the plan became [specs/phase-13-honest-suggestions.md](specs/phase-13-honest-suggestions.md)
  and [specs/phase-14-corner-anchored-placement.md](specs/phase-14-corner-anchored-placement.md).

- **2026-09-12 — Phase 12 shipped: candidates seeded from real streets, final
  selection spread across the map.** `match/straights.ts` (new):
  `findMatchingStreetStraights` runs `geometry/straight.ts`'s existing
  `longestStraight` (`closed: false`) over every bundled street independently
  and keeps those whose own longest straight lands within
  `[MIN_STRAIGHT_RATIO 0.6, MAX_STRAIGHT_RATIO 1.6]` of the circuit's own
  longest straight length (already computed per circuit in Phase 1); for each
  match, `seedFromStraight` returns two candidates — the street's bearing and
  its reverse — each placing the circuit's own straight's midpoint onto the
  street straight's midpoint. `match/search.ts`'s `searchPlacements` scores
  these seeds with the same `scoreCandidate` the grid sweep uses and merges
  them into the same `coarse` array before `coarseKeep`/refine, so they get
  identical downstream treatment, not a special case. `SearchInput` gained
  `ways` (raw street ways, for straight-matching) and `circuitStraight` (the
  circuit's own straight, local frame); `app/map.ts`'s `onSuggest` supplies
  both from data it already had in scope. Final selection's old single accept
  loop (sort by score, dedup, take `resultCount`) became a **two-pass accept**:
  pass one fills slots only with candidates at least `diversityDistM` (800 m)
  from every already-accepted one; pass two fills any slots still empty from
  the remaining (already deduped) candidates in plain score order, so a
  circuit with genuinely only one good spot in Porto still gets a full result
  set. The accepted list is re-sorted by score before being returned, so
  presentation order is unaffected — diversity changes *which* candidates get
  in, not how the ones that do are ranked.
  **Real-data result:** run against all three bundled circuits, straight
  matching found real candidate streets across the whole bbox, not just near
  the coarse grid's raw-score peak — **39 matching street straights for
  hungaroring, 46 for silverstone, 12 for catalunya**. The spread this phase
  targets — maximum pairwise distance between the final 5 accepted anchors —
  is now **4687 m (hungaroring), 5449 m (silverstone), 1057 m (catalunya)**:
  hungaroring and silverstone's suggestions now span most of the bundled
  bbox; catalunya, with far fewer matching streets found (12 vs. 39/46),
  spread less — an honest reflection of what real Porto streets actually offer
  for that circuit's particular straight length, not a shortfall in the
  diversity logic itself (its two-pass accept still ran; there just weren't
  many genuinely-separate good spots to spread across). No pre-Phase-12
  spread number was captured for a direct before/after delta (the metric
  itself — max pairwise anchor distance — is new, added by this phase's own
  test), but these numbers are a direct, structural fix for the exact
  complaint in the 2026-09-11 open question: suggestions no longer come only
  from wherever the coarse grid's raw coverage score happens to peak.
  `routedCount` stays 0 for all three, unaffected by design — this phase
  changes which poses get proposed and how the final list is spread, not the
  Phase 8 routing validation on top of them. Best-effort loop quality
  (Phase 11's metric) shifted slightly with the new, more varied candidate
  pool — best-row length ratios now 1.91×/1.43×/1.84× (hungaroring/
  silverstone/catalunya) vs. Phase 11's 1.89×/1.22×/1.84× — an expected,
  accepted trade of trading a narrower search for geographic spread, not a
  regression in Phase 11's own mechanism. 286 tests pass (`npm run build`
  clean; two pre-existing 5 s-timeout tests — `graph.test.ts`'s real-data
  connectivity check and several of `app/map.test.ts`'s — fail only when the
  full suite runs under heavy parallel load and pass cleanly in isolation, the
  same known resource-profile characteristic noted in the Phase 10 decision
  log, not a Phase 12 regression). Full spec:
  `docs/specs/phase-12-anchor-on-real-streets.md`.

- **2026-09-12 — Phase 11 shipped: best-effort loops snap by direction, not
  just distance.** `StreetGraph.nearestAlignedPointM` (new) mirrors
  `nearestPointM` but filters candidate street segments by heading alignment
  first, the same test `StreetIndex.nearestAlignedM` (Phase 6's own candidate
  scoring) already used — `objective.ts`'s `scoreCandidate` used it for
  scoring, but loop *construction* (`tryRouteLoop`/`buildBestEffortLoop`)
  never had, snapping every sample by plain nearest-distance instead. Both now
  snap through the aligned search, using each sample's own local heading
  (`objective.ts`'s new `localHeading`, factored out of `scoreCandidate` so
  it's computed one way, not duplicated). A sample with no aligned street
  within `LOOP_SNAP_MAX_M` is unresolved outright — a gap for
  `buildBestEffortLoop`, a rejection for `tryRouteLoop` — never a silent
  fall-back to the nearest wrong-direction point, exactly as designed.
  Implementing this against the existing test suite surfaced one real
  constraint the spec hadn't spelled out: `localHeading`'s fixed
  `HEADING_SPAN`-index window degenerates (a zero-length heading, since ahead
  and behind indices coincide) on a ring with 4 or fewer points — never true
  for a real resampled circuit, but true of several hand-built 4-point test
  rings, which needed a couple of extra (unsampled) points added purely to
  give `localHeading` room to compute a real chord; separately, several
  pre-Phase-11 tests built around perfect 90° street corners needed an
  explicit wide `alignMaxRad` override, since the local heading *at* a sharp
  corner is an inherent ~45° blend of the two streets meeting there, unrelated
  to what those tests (connectivity, ranking, length rejection) actually
  exercise. Neither affects real usage: `LOOP_SAMPLES` defaults to 60, and
  actual F1 corners are curved, not right angles.
  **Real-data result:** see the Phase 11 entry under Phases above for the
  full before/after — every bundled circuit's best best-effort suggestion is
  now under 1.9× its own length, down from the 2.1–3.6× range Phase 10
  shipped with, at the cost of higher reported gap counts (an accepted,
  honest trade, not a regression). `routedCount` stays 0 for all three,
  unaffected by design. 277 tests pass (`npm run build` clean).

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

Resolved:

- ~~Phase 6 suggestions look clustered in one part of the bbox~~ →
  confirmed by real-world use, fixed by Phase 12's straight-anchored seeding
  and diversity pass: final-suggestion spread (max pairwise anchor distance)
  is now 4687 m (hungaroring), 5449 m (silverstone), 1057 m (catalunya) — see
  the Phase 12 decision-log entry (2026-09-12).
- ~~Circuit geometry source: OSM raceway ways vs. a public F1 GeoJSON dataset~~ →
  OpenStreetMap raceway ways, normalised copy in the repo (2026-09-09).
- ~~Which circuits to bundle first~~ → `hungaroring`, `silverstone`, `catalunya`
  (2026-09-09).

- ~~Frontend: plain TypeScript vs. a small framework~~ → plain TypeScript + Vite
  (2026-09-09).
