# Spec — Phase 6: Suggested placements

Status: `done` (shipped 2026-09-10 — see the ROADMAP decision log for the
constant tuning and real-data timing; 2026-09-11 follow-up made the coverage
test *directional* and unified the suggestion label with the live map figure)
Depends on: [phase-2-map-overlay.md](phase-2-map-overlay.md),
[phase-3-street-proximity.md](phase-3-street-proximity.md),
[phase-5-trace-and-study.md](phase-5-trace-and-study.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Every phase so far leaves the user to find a placement entirely by hand. This
phase adds an **opt-in "Suggest placements"** action: given the chosen circuit,
search the bundled Porto street network for spots where the circuit shape would
sit well on real streets, and offer the best handful as ranked starting points.

The user still does the work the vision cares about — they pick a suggestion,
hand-tune it (Phase 2), judge it (Phase 3), trace it (Phase 5). A suggestion is
a **shortcut to a promising starting position**, never a verdict and never
applied automatically.

This is the geometry-only first cut of the roadmap's "automatic matching" item.
Finding an actual connected street *loop* and comparing its shape (which needs a
routable graph) and searching beyond the bundled Porto box (which needs
Overpass) stay later items — see *Not in scope*.

## How it stays true to the vision

The vision says *judgement stays with the user; no automated "match score" is
required for the core workflow*. This phase keeps that:

- **Opt-in.** Nothing runs until the user clicks **Suggest placements**. There
  is no auto-search on load, no auto-select.
- **Advisory.** A suggestion only sets the Phase 2 placement (anchor / rotation
  / scale). The overlay stays fully draggable afterwards; the user is expected
  to adjust it.
- **Familiar numbers.** Each suggestion is labelled with the same
  *"NN % on streets"* coverage figure the user already knows from Phase 3, plus
  a mean/max deviation in metres (Phase 5 style). The internal ranking also uses
  turning-function and Procrustes shape distances, but those are plumbing — they
  are not shown as a headline score.
- **No ranking pressure.** The list is "spots worth a look", ordered; picking
  #3 is as valid as picking #1.

## Vocabulary

- **Candidate** — a similarity transform (translation + rotation, at a fixed
  scale) placing the circuit centreline in the Porto metric frame.
- **Score** — a candidate's combined objective: high street coverage, low
  turning-function distance, low Procrustes residual. Used only to rank.
- **Suggestion** — a surviving candidate after the search and de-duplication,
  carried to the UI as `{ placement: Placement, coverageFraction, meanDeviationM,
  maxDeviationM }`.

## Decisions locked for this phase

- **Bundled Porto network only.** The search runs against
  `porto-streets.json` + the Phase 3 grid index. No Overpass, no runtime
  network — the offline guarantee holds. Suggestions therefore only ever land
  inside the Phase 3 bbox.
- **Fixed scale.** The search is over translation + rotation at the **current
  UI scale** (default `1.0`, true size). Scale stays a 3rd degree of freedom the
  user sets, not something the search explores — real scale by default (vision).
  A distance-target search composes later with the roadmap's "scale target by
  distance" item.
- **Coarse-to-fine, time-sliced on the main thread.** A generator
  (`searchPlacements`) does a coarse grid sweep, keeps the best `COARSE_KEEP`,
  refines each with a local sweep, de-duplicates, and returns the top
  `RESULT_COUNT`. The driver pumps the generator in ~12 ms slices, yielding to
  the event loop between them, so the panel shows a live progress bar and
  **Cancel** works. No Web Worker (keeps the build simple); if the slicing ever
  feels janky a worker is a drop-in optimisation behind the same driver.
- **Objective per candidate.** Sample the transformed centreline at
  `SEARCH_SAMPLES` points; for each, query the grid index for the nearest street
  point within `SEARCH_MAX_M`. Then:
  - `coverage` — fraction of samples with a street within `NEAR_M` (Phase 3's
    constant). Want high.
  - `turningDistance` — the transformed centreline's cumulative turning function
    vs the *snapped* polygon's (sample `i` ↔ its nearest street point). Compared
    pointwise (same start, same orientation — the candidate transform already
    fixes both), mean-difference removed, RMS. Want low. Penalises placements
    where streets zig-zag under a smooth circuit stretch or vice versa.
  - `procrustesResidual` — RMS residual of the best similarity fit (no
    reflection) mapping the snapped points back onto the circuit samples. Want
    low. Penalises placements where the near-street points don't actually form
    the circuit's shape.
  - `score = coverage − W_TURNING · turningDistance − W_PROCRUSTES · procrustesResidualNorm`
    (`procrustesResidualNorm` = residual / circuit bounding radius, so the
    weights are scale-free). A candidate with `coverage < MIN_COVERAGE` is
    dropped outright — no point ranking placements that are mostly off-street.
- **De-duplication.** Two survivors are the "same" placement if their anchors
  are within `DEDUP_DIST_M` and their rotations within `DEDUP_ROT_DEG`
  (mod the circuit's rotational symmetry is ignored — keep it simple). Keep the
  higher score of each cluster.
- **Applying a suggestion** sets `state.placement` to the suggestion's transform
  via a new `applyPlacement` reducer and **clears the traced route** (it
  belonged to the previous placement) — with a `window.confirm` first if a route
  exists. `currentAttemptId`-style "unsaved changes" then reflects the new
  placement as usual (Phase 4).
- **Preview.** Hovering / selecting a result row draws that placement's
  centreline as a dashed outline (the Phase 4 preview style) without touching
  state; leaving the list clears it.
- **Tests:** `geometry/turning`, `geometry/procrustes`, the extended street
  index, `match/objective` and `match/search` are pure with full unit coverage
  (including `fast-check` invariants and a planted-optimum search test). The
  panel and the map glue keep their jsdom smoke tests, extended to "suggest →
  results list → use → overlay moved".

## Repository layout after this phase

```text
src/
├── geometry/
│   ├── turning.ts              # NEW cumulativeTurning, turningDistance (pure)
│   ├── turning.test.ts
│   ├── procrustes.ts           # NEW fitSimilarity, procrustesResidual (pure)
│   └── procrustes.test.ts
├── streets.ts                  # StreetIndex gains nearestPointM(p, maxM)
├── streets.test.ts             # extended
├── match/
│   ├── types.ts                # NEW Suggestion, Candidate, SearchInput, SearchProgress, SearchOptions
│   ├── objective.ts            # NEW scoreCandidate (pure)
│   ├── objective.test.ts
│   ├── search.ts               # NEW searchPlacements generator: coarse → refine → dedupe (pure)
│   └── search.test.ts
├── app/
│   ├── suggest.ts              # NEW driver: pump searchPlacements in time slices, progress + cancel
│   ├── suggest.test.ts
│   ├── state.ts                # + applyPlacement reducer
│   ├── state.test.ts           # extended
│   ├── map.ts                  # wire the button, progress, results list, preview outline, apply
│   └── map.test.ts             # extended
└── ui/
    ├── controls.ts             # + "Suggest placements" section: button / progress / results
    └── controls.test.ts        # extended
```

`circuits.ts`, `porto.ts`, `app/overlay.ts`, `app/rotate.ts`, `app/proximity.ts`,
`app/trace.ts`, `placements.ts` are unchanged. No new data files, no new
dependency.

## New / changed code

### `geometry/turning.ts` (pure)

```ts
/** Cumulative signed turning angle (radians) at each vertex of the path,
 *  starting at 0 for the first segment. Includes the closing segment when
 *  `closed`. Length === path.length (closed) or path.length - 1 (open). */
export function cumulativeTurning(path: Path, closed?: boolean): number[]

/** RMS of (a[i] - b[i]) after removing the mean difference. `a` and `b` must be
 *  the same length (same sample count, same start index, same orientation). */
export function turningDistance(a: readonly number[], b: readonly number[]): number
```

### `geometry/procrustes.ts` (pure)

```ts
/** Best similarity transform (uniform scale > 0, rotation, translation — no
 *  reflection) mapping `from` onto `to`, in the least-squares sense. Closed-form
 *  2D solution; `from` and `to` must be the same non-zero length. */
export function fitSimilarity(from: readonly Point[], to: readonly Point[]): SimilarityTransform

/** RMS residual |T(from_i) - to_i| for T = fitSimilarity(from, to). */
export function procrustesResidual(from: readonly Point[], to: readonly Point[]): number
```

### `streets.ts` — index addition

```ts
export type StreetIndex = {
  nearestDistanceM(p: Point, maxM: number): number
  /** The nearest point on any street within `maxM`, or null. `distanceM` is
   *  capped at `maxM` (and === nearestDistanceM(p, maxM)). */
  nearestPointM(p: Point, maxM: number): { distanceM: number; point: Point | null }
}
```

`nearestDistanceM` becomes `nearestPointM(p, maxM).distanceM`; the segment scan
is factored into one internal helper so behaviour is identical.

### `match/types.ts`

```ts
export type Candidate = { anchorM: Point; rotationRad: number }  // Porto-frame metres

export type Suggestion = {
  placement: Placement            // anchor as [lon, lat], ready for the overlay
  coverageFraction: number        // 0..1, "NN % on streets"
  meanDeviationM: number
  maxDeviationM: number
}

export type SearchInput = {
  circuitSamplesM: readonly Point[]   // centreline resampled, centroid at origin
  scale: number                       // the fixed search scale
  index: StreetIndex
  bbox: BBox                          // Porto-frame metric bounds to sweep
}

export type SearchProgress = { done: number; total: number }
export type SearchOptions = Partial<{ resultCount: number; /* … tuning knobs … */ }>
```

### `match/objective.ts` (pure)

- `scoreCandidate(input: SearchInput, c: Candidate, samples: number): CandidateScore`
  — transform the circuit samples by `(scale, rotation, translate = anchorM)`,
  snap each via `index.nearestPointM`, compute `coverage`, `turningDistance`,
  `procrustesResidual`, `meanDeviationM`, `maxDeviationM`, and the combined
  `score`. `CandidateScore` carries all of them.

### `match/search.ts` (pure)

```ts
export function* searchPlacements(
  input: SearchInput,
  opts?: SearchOptions,
): Generator<SearchProgress, Suggestion[]>
```

1. **Coarse sweep** — anchors on a `COARSE_GRID_M` lattice over `bbox`,
   rotations every `COARSE_ROT_DEG`, `SEARCH_SAMPLES_COARSE` samples. Yield
   progress each grid row. Keep the top `COARSE_KEEP` by score
   (`coverage ≥ MIN_COVERAGE` required).
2. **Refine** — for each kept candidate, a local sweep: anchors within
   `±REFINE_SPAN_M` at `REFINE_STEP_M`, rotations within `±REFINE_SPAN_DEG` at
   `REFINE_STEP_DEG`, `SEARCH_SAMPLES_FINE` samples. Keep the best local result.
3. **De-duplicate** the refined results (`DEDUP_DIST_M`, `DEDUP_ROT_DEG`).
4. Convert the top `RESULT_COUNT` to `Suggestion`s: `anchorM` →
   `portoProjection().toLonLat`, `rotationRad` as-is, `scale` = `input.scale`.
   (The Porto frame and the circuit's own local frame are both ENU and differ
   by < 0.5 % over this bbox — close enough for a starting point the user
   tunes.)

The generator is fully synchronous; a test drives it to completion in a loop.
The `app/suggest.ts` driver is what makes it cooperative.

### `app/suggest.ts` (glue, pure-ish)

```ts
export type Suggester = {
  run(input: SearchInput, onProgress: (p: SearchProgress) => void): Promise<Suggestion[]>
  cancel(): void
}
export function createSuggester(): Suggester
```

`run` pumps `searchPlacements` in `SLICE_MS`-bounded batches, `await`ing a
macrotask (`setTimeout(0)`) between batches and calling `onProgress`. `cancel()`
makes the next batch call `gen.return([])` and the promise resolve with `[]`.
No timers left dangling on resolve/cancel.

### `app/state.ts`

- `applyPlacement(state, placement: Placement): AppState` — replaces
  `state.placement` (copied) and sets `route: []`. Used by "Use this" and
  available for any future "jump to a placement" need.

### `ui/controls.ts`

`ControlsView` gains:

- `suggest: { phase: 'idle' | 'running' | 'results'; progress?: SearchProgress;
  suggestions: readonly Suggestion[]; selectedIndex: number | null }`.

`renderControls` adds a **"Suggest placements"** section under the circuit
picker:

- `phase: 'idle'` — a `data-role="suggest"` button (disabled while
  `previewingSaved` or `tracing`).
- `phase: 'running'` — a progress bar (`data-role="suggest-progress"`,
  `value`/`max` from `progress`) and a `data-role="suggest-cancel"` button.
- `phase: 'results'` — a `<ol data-role="suggest-list">`, one row per
  suggestion: `"NN % on streets · ~NN m avg"`, a `data-role="suggest-use"`
  button and `data-suggest-index` on the row (hover / focus →
  `onPreviewSuggestion(i)`); plus a `data-role="suggest-clear"` button to
  dismiss the list.

`ControlsHandlers` gains `onSuggest()`, `onCancelSuggest()`,
`onUseSuggestion(i)`, `onPreviewSuggestion(i | null)`, `onClearSuggestions()`.
Still pure render-to-string + explicit `bind`.

### `app/map.ts` (glue)

- Build `createSuggester()` once; `destroy()` calls `cancel()`.
- `onSuggest()`: assemble `SearchInput` — `circuitSamplesM` =
  `resample(circuit.metricCentreline, SAMPLE_M)` (reuse the existing resample),
  `scale` = `state.placement.scale`, `index` = the Phase 3 `streetIndex`
  (already built on load), `bbox` = the network bbox in Porto-frame metres.
  Set `suggest.phase = 'running'`, re-render the panel on each `onProgress`
  (throttled to animation frames), then `phase = 'results'` with the returned
  list.
- `onPreviewSuggestion(i)`: draw `overlayLatLngs(circuit, suggestions[i].placement)`
  on the existing preview/bucket path as a dashed outline; `i === null` restores
  the live overlay. Reuses the Phase 4 preview rendering.
- `onUseSuggestion(i)`: if `state.route.length` → `window.confirm`; then
  `state = applyPlacement(state, suggestions[i].placement)`,
  `map.setView(anchor)`, `suggest.phase = 'idle'`, clear suggestions, re-render.
- `onCancelSuggest()` / `onClearSuggestions()`: `suggester.cancel()` /
  drop the list; back to `phase: 'idle'`.
- Changing circuit, entering trace mode, or toggling preview all reset
  `suggest` to idle and clear any suggestion list.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `NEAR_M` | `10` | reused from `app/proximity` — a sample is "on a street" within this |
| `SEARCH_MAX_M` | `40` | snap search radius for the objective |
| `MIN_COVERAGE` | `0.45` | drop candidates below this coverage before ranking |
| `SEARCH_SAMPLES_COARSE` | `48` | centreline samples in the coarse sweep |
| `SEARCH_SAMPLES_FINE` | `96` | centreline samples in the refine sweep |
| `COARSE_GRID_M` | `300` | coarse anchor lattice step |
| `COARSE_ROT_DEG` | `30` | coarse rotation step |
| `COARSE_KEEP` | `24` | coarse candidates carried into refine |
| `REFINE_SPAN_M` / `REFINE_STEP_M` | `180` / `60` | local anchor sweep |
| `REFINE_SPAN_DEG` / `REFINE_STEP_DEG` | `18` / `6` | local rotation sweep |
| `RESULT_COUNT` | `5` | suggestions shown |
| `DEDUP_DIST_M` / `DEDUP_ROT_DEG` | `200` / `12` | "same placement" thresholds |
| `W_TURNING` / `W_PROCRUSTES` | `0.15` / `0.20` | ranking weights (tune during build) |
| `SLICE_MS` | `12` | driver time-slice budget |

Concrete work estimate: coarse ≈ `(9400/300)·(5300/300)·(360/30)` ≈ 6 700
candidates × 48 snaps; refine ≈ `24·(7·7)·(7)` ≈ 8 200 candidates × 96 snaps.
~1.2 M snap queries total — around 1–2 s of compute, sliced so the UI never
freezes. Report the real timing in the ROADMAP entry.

## Tests

All offline, default vitest environment except the two jsdom smoke tests.

- **`geometry/turning`**: a unit square → four `π/2` steps, total `2π`;
  `cumulativeTurning` length matches the contract; `turningDistance(f, f) === 0`;
  `turningDistance` is unchanged when a constant is added to every element of one
  input (mean-difference removal); grows for a genuinely different shape.
- **`geometry/procrustes`**: `procrustesResidual(p, p) ≈ 0`; a rotated + scaled +
  translated copy → `≈ 0` and `fitSimilarity` recovers the transform;
  a **reflected** copy → clearly `> 0` (no reflection allowed); a sheared copy
  → `> 0`; `fast-check`: residual invariant to a similarity applied to `to`.
- **`streets`**: `nearestPointM` returns a point actually on the nearest
  segment; `distanceM === nearestDistanceM(p, maxM)`; `point === null` and
  `distanceM === maxM` when nothing is in range.
- **`match/objective`**: circuit samples laid exactly on a synthetic street grid
  → `coverage ≈ 1`, `turningDistance ≈ 0`, `procrustesResidual ≈ 0`, high
  `score`; the same in open space → `coverage 0`, dropped; a placement half on /
  half off → mid `coverage`, `score` between the two.
- **`match/search`**: on a synthetic network containing one planted circuit-shaped
  street loop, the top suggestion's anchor is within `COARSE_GRID_M` and its
  rotation within `COARSE_ROT_DEG` of the planted pose; the result list is
  de-duplicated (no two within the thresholds) and length ≤ `RESULT_COUNT`; the
  generator yields monotonic non-decreasing progress ending at `done === total`.
- **`match/search` (real data, may be marked slow)**: with the real
  `porto-streets.json` index and a real circuit, `[...searchPlacements(...)]`
  returns 1–`RESULT_COUNT` suggestions, every `placement.anchor` inside the
  bbox, all scores finite, completes under a generous CI time budget.
- **`app/suggest`**: `run` resolves with the same list the generator produces and
  calls `onProgress` at least once with `done === total` at the end; `cancel()`
  mid-run resolves the promise with `[]` and leaves no pending timer
  (`vi.useFakeTimers` + assert `vi.getTimerCount() === 0`).
- **`app/state`**: `applyPlacement` replaces the placement (copied, not aliased)
  and clears the route; is pure.
- **`ui/controls`**: idle renders the button (disabled while tracing); running
  renders a progress bar bound to `progress` and a cancel button; results render
  one row per suggestion with the coverage label, a use button carrying the
  index, and a clear button; `bind` fires each handler with the right index.
- **`app/map` (jsdom)**: with `searchPlacements` stubbed to return two fixed
  suggestions, clicking `data-role="suggest"` moves the panel to a results list;
  `data-role="suggest-use"` on the first row changes the overlay ring
  (`overlayLatLngs` output differs) and pans the map; `data-role="suggest-clear"`
  returns to idle; `destroy()` cancels cleanly.

## Acceptance criteria

- `npm run dev`: with a circuit chosen, **Suggest placements** runs a visible
  progress bar (cancellable) and then shows up to five ranked starting spots,
  each labelled with a "% on streets" figure and a rough deviation.
- Hovering a suggestion previews its outline on the map without changing
  anything; **Use this** drops the circuit onto that spot (panning to it) and
  leaves it fully draggable for hand-tuning. If a route was traced, the user is
  asked before it is cleared.
- The search never blocks the UI for more than a slice, makes no network
  request, and only ever suggests locations inside the bundled Porto area.
- No suggestion is ever applied automatically; there is no headline match score.
- `npm run test:run` and `npm run build` pass; the search's real-data timing is
  reported.
- `docs/ROADMAP.md` (Phase 6 → `done`, dated decision-log entry, priority → next
  item) and `RELEASES.md` updated per the working method.

## Not in scope

- **A routable street graph** — connectivity, finding an actual closed street
  loop, routing between clicked points, or snapping the traced route to streets.
  The objective here only measures nearest-point proximity and shape fidelity of
  the *snapped samples*, not that a runnable loop exists. (Later roadmap item.)
- **Searching beyond the bundled Porto box** / any Overpass call. (Later item —
  it needs the "street network beyond Porto" work first.)
- **Searching over scale** or matching to a target distance. (Composes with the
  "scale target by distance" roadmap item.)
- **Matching the user's traced route** (or a freehand sketch) against the
  network to find where a circuit-like loop is — the objective functions would
  be reusable, but the UX and input are a separate design.
- Auto-running the search, auto-selecting a circuit, or ranking that forces a
  choice.
- Persisting suggestions, or storing the score on a saved placement.
- Tuning the circuit's rotational symmetry into the de-duplication.
