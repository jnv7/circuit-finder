# Roadmap

Living document: phases, current priority, decisions, open questions, and future
ideas. See [VISION.md](VISION.md) for the product goal and
[../CONVENTIONS.md](../CONVENTIONS.md) for engineering rules.

## Current priority

**Choosing the next phase.** Phases 0–6 are `done` — the acetate workflow now
covers overlay, street-proximity feedback, save/restore, trace & study, and
opt-in suggested placements. Nothing is scheduled next; the candidates are in
the *Later* list below. The natural follow-on is **a routable street graph**
(connectivity built from the bundled geometry): it turns Phase 6's geometry
hint into a real found-loop match and gives snap-to-street for tracing. Needs a
spec in `docs/specs/` before implementation.

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
- A routable street graph built from the bundled geometry: connectivity, finding
  an actual closed street loop of the circuit's shape, routing between clicked
  points, and snapping a traced route to the network. Turns Phase 6's geometry
  hint into a real found-loop match (turning function + Procrustes on the routed
  loop).
- Editable circuit scale target by distance instead of 1:1 (composes with the
  Phase 6 search to add a scale degree of freedom).
- Matching a freehand sketch / the user's traced route against the network to
  find circuit-like loops (reuses the Phase 6 objective functions).
- More circuits; auto-select the circuit for the current race weekend.
- GPX export of the traced route.

## Decision log

Newest first. Each entry dated.

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

- ~~Circuit geometry source: OSM raceway ways vs. a public F1 GeoJSON dataset~~ →
  OpenStreetMap raceway ways, normalised copy in the repo (2026-09-09).
- ~~Which circuits to bundle first~~ → `hungaroring`, `silverstone`, `catalunya`
  (2026-09-09).

- ~~Frontend: plain TypeScript vs. a small framework~~ → plain TypeScript + Vite
  (2026-09-09).
