# Spec — Phase 8: Routed loop suggestions

Status: `todo`
Depends on: [phase-6-suggested-placements.md](phase-6-suggested-placements.md),
[phase-7-street-graph.md](phase-7-street-graph.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phase 6's **Suggest placements** ranks spots by *nearest-street proximity*, not
by whether a real connected loop exists there — a suggestion can show "63% on
streets" while a third of that is samples that happen to sit near streets they
only cross, with buildings under the rest. Phase 7 built a routable graph but
deliberately limited its use to manual tracing (see that spec's *Not in
scope*). This phase closes the gap: for each geometry-ranked candidate, try to
build a **real, fully street-connected closed loop** that follows the
candidate's placed circuit outline, using Phase 7's graph. Suggestions backed
by one of these are shown with their real loop length and how far that real
loop strays from the circuit's shape — the same plain-metres language Phase 5
already uses for a hand-traced route — instead of a coverage percentage that
stops meaning much once the loop is provably real.

This reuses, rather than replaces, Phase 6's search: the coarse-to-fine
translate + rotate sweep still finds *where* to look. This phase adds a
second pass that asks the harder question Phase 6 never could — "is there
actually a way to run this, street to street, all the way around?" — and
answers it by routing, not estimating.

## How it stays true to the vision

- **Opt-in, still one button.** "Suggest placements" keeps its name and
  location; nothing changes about *when* it runs.
- **Advisory, more honestly so.** A routed suggestion seeds both a placement
  *and* a ready-made traced route (Phase 5's `AppState.route`) — but that
  route is exactly as editable afterwards as anything hand-traced: Undo,
  Clear, re-click to extend it. Nothing is locked in; the user is still
  expected to look at it and adjust.
- **Judgement stays with the user; plain metres, no score.** A routed
  suggestion's "on streets" figure would be trivially ~100% by construction —
  showing it as a headline number would look like a manufactured score. This
  phase drops it in favour of the loop's real length and its mean/max
  deviation from the circuit's shape, in metres — literally `app/trace.ts`'s
  existing `routeStats`, the same numbers the panel already shows once a
  route is traced by hand. Consistency, not a new number.
- **Static and offline.** Built entirely from the already-bundled graph +
  street index; no new data, no new dependency, no network call.
- **Graceful, not all-or-nothing.** Porto's grid will not always yield a full
  loop for every circuit and scale. When it can't, the feature still shows
  Phase 6's old geometry-only suggestions rather than an empty list — a
  worse-but-still-useful answer beats none.

## Vocabulary

- **Candidate** — Phase 6's term: a translation + rotation pose (fixed scale)
  placing the circuit centreline in the Porto metric frame. Unchanged.
- **Loop attempt** — for one candidate, resample its placed outline at
  `LOOP_SAMPLES` even points, resolve each to the street graph, and try to
  connect them consecutively (closing back to the first) by real shortest
  path. Succeeds or fails as a whole — see *Decisions locked*.
- **Routed loop** — the result of a successful loop attempt: the real,
  connected closed polyline actually run, its length, its deviation from the
  placed circuit outline it was built from, and whether it is **simple**.
- **Simple** — a routed loop where no underlying street edge is run twice.
  Connected is not the same as closed-in-the-useful-sense: nothing in a loop
  attempt stops the shortest path between one pair of samples from reusing a
  stretch of street another leg already used (a single-access side street is
  the common case — the only way in is the only way out). That loop is
  technically connected end to end but is really a there-and-back spur
  wearing a loop's clothes, and is worth less to a runner than one that never
  repeats a metre of street. `RoutedLoop.simple` names the difference
  directly instead of leaving the user to spot it on the map.
- **Routed suggestion** — a Phase 6 `Suggestion` with a routed loop attached.
  Shown before every fallback suggestion; simple ones before non-simple ones;
  within each group, ranked by how closely the loop tracks the circuit's
  shape.
- **Fallback suggestion** — a Phase 6 `Suggestion` with no routed loop (none
  was found, or the search gave up trying more candidates once enough routed
  ones were found). Shown and labelled exactly as Phase 6 always has.

## Decisions locked for this phase

- **Validate by routing, don't search the graph freeform.** The candidate
  poses still come entirely from Phase 6's existing `searchPlacements` —
  unchanged, called with a larger `resultCount` so there is a bigger pool to
  try routing on (`LOOP_CANDIDATE_POOL`, default `24`, vs the `5` normally
  shown). This phase does **not** add a graph search that bends or grows a
  loop shape-first (e.g. a beam search through streets) — that is a
  materially different, harder algorithm and stays a later item if this
  simpler validate-what-Phase-6-already-found approach turns out to be too
  limited in practice.
- **A loop attempt is all-or-nothing.** For one candidate: resample its
  placed outline (closed ring) at `LOOP_SAMPLES` even points; each must
  resolve via `StreetGraph.nearestPointM(_, LOOP_SNAP_MAX_M)` — any miss
  fails the whole candidate. Consecutive resolved nodes (wrapping the last
  back to the first, closing the loop) must each connect via
  `StreetGraph.shortestPath` — any `null` fails the whole candidate. This is
  stricter than Phase 5/7 tracing's per-leg straight-line fallback on
  purpose: a *suggestion* claims "here is a loop you can actually run", so it
  must not silently patch a gap with an imaginary straight line the way
  advisory tracing does.
- **A sanity cap on real length, not on shape closeness.** A successful
  attempt is still rejected if its real length exceeds `MAX_LENGTH_RATIO` ×
  the circuit's length at the current scale — the guard for a loop that
  legitimately connects but only by a long detour (a single-access side
  street forcing a there-and-back, say), which would not necessarily show up
  as high deviation if the detour happens to run near the outline anyway.
  Beyond that, attempts are not rejected for looking like a loose fit; they
  are ranked, worst first out.
- **Loop deviation reuses `app/trace.ts`'s `routeStats` — not Phase 6's
  turning-function / Procrustes distance.** Once a loop is real, it has an
  actual point sequence to compare against the placed circuit ring, which is
  exactly what `routeStats`/`routeDeviation` already do for a hand-traced
  route (resample both, symmetric nearest-distance, mean/max in metres). That
  is a better fit than Phase 6's turning-function/Procrustes machinery, which
  exists precisely because Phase 6 only has *snapped sample points*, not a
  real path, to compare — and it keeps the "plain metres, no score"
  vocabulary consistent across manual tracing and routed suggestions. (This
  is a deliberate refinement of the ROADMAP's earlier one-line note "turning
  function + Procrustes on the routed loop" — written before this spec
  existed — in favour of reusing already-shipped, already-tested code that
  fits the vision's own stated principle better.)
- **Simplicity is detected by edge reuse, cheaply.** `graph.ts`'s
  `StreetGraph.shortestPath` gains a third field on its result, `edgeIds:
  readonly number[]` — the internal edge indices the path walked, in order.
  Opaque outside the graph (stable only within one `buildStreetGraph` call);
  meaningful only for exactly this: after routing every leg of a loop
  attempt, `simple` is true iff no edge id appears in more than one leg's
  `edgeIds`. A* cannot revisit a node within a single leg (non-negative
  weights), so an edge can only repeat *across* legs, never within one — the
  check is a single pass over a `Set`, no geometry, no new dependency. This is an
  additive, backward-compatible change to an already-shipped Phase 7 type;
  `app/trace.ts`'s `expandRoute` (the only other caller) only reads
  `.points`/`.lengthM` today and is unaffected.
- **Ranked simple-first, then by deviation.** Routed suggestions sort with
  every `simple` one before every non-simple one; within each group, by
  `meanDeviationM` ascending (ties by `maxDeviationM`). Loop length is shown
  but not an independent ranking term — a close-fitting loop is, in practice,
  close to the right length too, and one fewer arbitrary weight to tune.
  Non-simple routed loops still rank above fallback suggestions — "connects,
  but repeats a street" is still more honest than a geometry-only guess.
- **Graceful fallback, not a smaller list.** The search tries candidates from
  the pool, best geometry-rank first, until either `LOOP_RESULT_COUNT` (`5`)
  routed suggestions (simple or not — the stopping condition doesn't wait for
  simple ones specifically, to keep the same bounded worst-case work) are
  found or the pool is exhausted. Whichever candidates never got tried, or
  were tried and failed, backfill the remaining slots (in their original
  geometry rank) as fallback suggestions — exactly Phase 6's old output — so
  the list is never emptier than it would have been before this phase.
- **Applying a routed suggestion seeds a route, not just a placement.**
  `app/state.ts`'s `applyPlacement` gains an optional third parameter,
  `route: readonly LonLat[] = []` — when a routed suggestion is used, its
  loop (converted to `LonLat[]`, closed by repeating the first point) is
  passed through; a fallback suggestion passes nothing, exactly today's
  behaviour. The existing "a route exists, confirm before replacing"
  `window.confirm` in `app/map.ts` covers both cases unchanged — the user is
  always asked before a suggestion (routed or not) discards a route they
  traced by hand.
- **Preview shows the loop, not just the outline.** Hovering a routed
  suggestion draws its loop as a second dashed polyline alongside the
  existing dashed circuit outline, without touching state — a new preview-only
  layer in `app/map.ts`, since the live `routeLine` always reflects
  `state.route` and must not flicker on hover. Hovering a fallback suggestion
  behaves exactly as Phase 6 (outline only).
- **Two-phase, still time-sliced, still cancellable.** Progress has two
  stretches — the Phase 6 geometry search, then the routing attempts — shown
  as two labelled stages rather than forced into one seamless bar (the total
  step count for stage one is a property of `searchPlacements`'s own run, not
  known up front without duplicating its internal formula). `app/suggest.ts`
  gains `createLoopSuggester`, sharing its slice-pump loop with the existing
  `createSuggester` via a small extracted helper — both still ~12 ms slices,
  `setTimeout(0)` between them, cancel leaves no dangling timer.

## Repository layout after this phase

```text
src/
├── graph.ts                     # shortestPath result gains edgeIds (additive)
├── graph.test.ts                # extended
├── match/
│   ├── types.ts                 # + RoutedLoop, RoutedSuggestion, LoopSearchOptions, LoopSearchProgress
│   ├── objective.ts              # `sampleIndices` exported (reused, was module-private)
│   ├── loopSearch.ts             # NEW tryRouteLoop (pure), searchRoutedLoops generator (pure)
│   └── loopSearch.test.ts
├── app/
│   ├── suggest.ts                # + createLoopSuggester, shared pump helper extracted
│   ├── suggest.test.ts           # extended
│   ├── state.ts                  # applyPlacement gains an optional `route` param
│   ├── state.test.ts             # extended
│   ├── map.ts                    # wire the loop suggester, preview-route layer, seed route on use
│   └── map.test.ts               # extended
└── ui/
    ├── controls.ts                # suggestion row branches on `.loop`; new label + formatting
    └── controls.test.ts           # extended
```

`match/search.ts`, `match/objective.ts`'s scoring itself, `app/trace.ts`,
`app/proximity.ts`, `streets.ts`, `placements.ts` are unchanged. No new data
file, no new dependency.

## New / changed code

### `graph.ts`

```ts
export type StreetGraph = {
  // … nodeCount, nodePosition, nearestNode, nearestPointM unchanged …
  /**
   * Real shortest path by length, or null if `from`/`to` are disconnected.
   * `edgeIds` are the internal edge indices walked, in order — opaque outside
   * this graph instance, stable only within one `buildStreetGraph` call;
   * useful only for detecting whether two paths reuse the same street edge.
   */
  shortestPath(from: NodeId, to: NodeId): { lengthM: number; points: Point[]; edgeIds: readonly number[] } | null
}
```

Purely additive — every existing caller destructures `.points`/`.lengthM` and
is unaffected.

### `match/objective.ts`

- `sampleIndices(n: number, k: number): number[]` — export the existing
  private helper ("`k` roughly evenly spaced indices into a ring of `n`
  points") so `loopSearch.ts` can pick the same kind of even spread over the
  circuit's dense resampled centreline without reimplementing it.

### `match/types.ts`

```ts
export type RoutedLoop = {
  /** The closed loop actually run, Porto-frame metres, first point repeated
   *  at the end. */
  points: Point[]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  /** True iff no underlying street edge was walked by more than one leg —
   *  a real closed loop, not a there-and-back spur that happens to connect
   *  end to end. */
  simple: boolean
}

export type RoutedSuggestion = Suggestion & {
  /** Present only when a real, fully connected loop was found for this pose. */
  loop?: RoutedLoop
}

export type LoopSearchProgress = SearchProgress & { phase: 'search' | 'route' }

export type LoopSearchOptions = SearchOptions & Partial<{
  loopCandidatePool: number
  loopResultCount: number
  loopSamples: number
  loopSnapMaxM: number
  maxLengthRatio: number
}>
```

### `match/loopSearch.ts` (pure)

```ts
/**
 * Try to build a real closed loop around `candidate`'s placed outline.
 * Resamples the placed ring at `opts.samples` even points; every one must
 * resolve on `graph` within `opts.snapMaxM`, and every consecutive pair
 * (closing the loop) must connect by `graph.shortestPath` — a single miss
 * returns `null`. A successful loop longer than `opts.maxLengthRatio` × the
 * circuit's length at `scale` is also rejected (a legitimately-connected but
 * far-detouring loop). `simple` is set from whether any leg's `edgeIds`
 * overlap another leg's — never rejected on its own, only reported.
 */
export function tryRouteLoop(
  circuitSamplesM: readonly Point[],
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { samples?: number; snapMaxM?: number; maxLengthRatio?: number },
): RoutedLoop | null

/**
 * Run Phase 6's search for a larger candidate pool (`loopCandidatePool`),
 * then try routing each (best geometry rank first) until `loopResultCount`
 * routed suggestions — simple or not — are found or the pool runs out.
 * Untried or failed candidates backfill the remainder as fallback (unrouted)
 * suggestions, in their original rank. Final order: every simple routed
 * suggestion (by `loop.meanDeviationM` ascending), then every non-simple
 * routed one (same ordering), then fallbacks in Phase 6's rank order.
 */
export function* searchRoutedLoops(
  input: SearchInput,
  graph: StreetGraph,
  opts?: LoopSearchOptions,
): Generator<LoopSearchProgress, RoutedSuggestion[]>
```

`searchRoutedLoops` delegates its first stretch of yields to
`yield* searchPlacements(input, { ...opts, resultCount: loopCandidatePool })`
(each forwarded progress object tagged `phase: 'search'`), then yields one
`phase: 'route'` step per candidate it attempts.

### `app/suggest.ts`

```ts
export type LoopSuggester = {
  run(
    input: SearchInput,
    graph: StreetGraph,
    onProgress: (p: LoopSearchProgress) => void,
    opts?: LoopSearchOptions,
  ): Promise<RoutedSuggestion[]>
  cancel(): void
}
export function createLoopSuggester(): LoopSuggester
```

The slice-pump loop (bounded bursts, macrotask yield, cancel via
`gen.return([])`) is extracted from today's `createSuggester` into a small
shared generic helper used by both — behaviour for `createSuggester` is
unchanged.

### `app/state.ts`

```ts
export function applyPlacement(
  state: AppState,
  placement: Placement,
  route: readonly LonLat[] = [],
): AppState
```

Existing call sites (fallback suggestions, and anything else using
`applyPlacement`) pass nothing for `route` and see no change. A routed
suggestion's `use` handler passes its loop's points (projected to `LonLat[]`,
closed by repeating the first point).

### `app/map.ts` (glue)

- Build `createLoopSuggester()` once alongside the existing suggester (or
  replace it — the loop suggester's `searchRoutedLoops` already reproduces
  Phase 6's own output shape for the fallback case, so one suggester now
  serves the button); `destroy()` cancels it.
- `onSuggest()`: same assembled `SearchInput`, plus `streetGraph` (already
  built for Phase 7 tracing). Progress rendering shows the current
  `phase` ("Searching placements…" / "Checking routes…") alongside the bar.
- A new inert preview layer, `previewRouteLine` (styled like `routeLine` but
  dashed, never bound to `state.route`): `onPreviewSuggestion(i)` sets its
  points from `suggestions[i].loop?.points` (cleared when absent or on
  `i === null`), alongside the existing outline preview.
- `onUseSuggestion(i)`: unchanged confirm-if-route-exists check; then
  `state = applyPlacement(state, chosen.placement, chosen.loop ? toLonLatClosed(chosen.loop.points) : [])`.
- Changing circuit, entering trace mode, or toggling preview all reset the
  suggestion list and clear the preview route layer, as today.

### `ui/controls.ts`

- `formatSuggestionLabel` branches three ways on the suggestion:
  - simple routed loop:
    `"${formatDistance(loop.lengthM)} closed loop · ${formatDeviation(loop)} off shape"`
    (both already-existing formatters — `formatDistance` from
    `app/overlay.ts`, `formatDeviation` from this file, since `RoutedLoop`
    carries the same `meanDeviationM`/`maxDeviationM` shape as `RouteStats`);
  - non-simple routed loop: the same, with a qualifier that it repeats a
    street, e.g. `"${formatDistance(loop.lengthM)} loop (retraces a street) · ${formatDeviation(loop)} off shape"`
    — visibly a lesser suggestion at a glance, not just lower in the list;
  - fallback: today's `"NN% on streets · ~NN m avg"` unchanged, reading
    clearly as neither of the above.
  Exact copy is free to change during implementation; the three-way
  distinction in the data is not.
- Row markup / `data-role`s unchanged — only the label text and the added
  preview-route behaviour change.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `LOOP_RESULT_COUNT` | `5` | suggestions shown (routed first, fallback after) |
| `LOOP_CANDIDATE_POOL` | `24` | geometry-ranked candidates tried before giving up |
| `LOOP_SAMPLES` | `60` | even points around the placed outline that must all resolve + connect |
| `LOOP_SNAP_MAX_M` | `30` | reused from Phase 7's `SNAP_MAX_M` — per-sample snap tolerance |
| `MAX_LENGTH_RATIO` | `1.5` | reject a routed loop longer than this × the circuit's length at scale |

Tune all of these against real data during implementation, same as Phase 6 —
report the measured real-data timing and the "how many of `LOOP_RESULT_COUNT`
came back routed vs fallback, for the bundled circuits at 1:1" figures in the
ROADMAP decision log.

## Tests

All offline, default vitest environment except the jsdom smoke tests.

- **`graph`**: `shortestPath`'s `edgeIds` has the same length as the number of
  edges the returned `points` actually walks (one id per edge traversed, not
  per point); two different `shortestPath` calls that are known to share one
  physical street segment (a synthetic T-junction, path A→B and path A→C both
  crossing the shared arm) report an overlapping id; two calls over disjoint
  parts of a synthetic grid report no overlap.
- **`match/objective`**: `sampleIndices` export has a test asserting the
  existing behaviour (`k >= n` returns every index; otherwise `k` evenly
  spread indices) now that it is public API.
- **`match/loopSearch` — `tryRouteLoop`**: on a synthetic graph laid out as a
  clean rectangular street loop matching a candidate's placed (rectangular)
  outline closely, returns a `RoutedLoop` with `simple: true`, low
  `meanDeviationM`, and `lengthM` close to the outline's own perimeter; a
  candidate with one sample in open space (no street within `snapMaxM`) →
  `null`; a candidate whose ring crosses a gap between two disconnected
  components → `null`; a candidate only reachable via a long detour (length >
  `maxLengthRatio` × target) → `null` even though every leg connects; a
  synthetic graph where the only way to close the loop is back out through a
  single-access side street (two legs forced onto the same edge) → a non-null
  `RoutedLoop` with `simple: false`.
- **`match/loopSearch` — `searchRoutedLoops`**: on a synthetic network with
  one planted loop matching the circuit shape and several candidates that
  cannot form a loop, the top suggestion is both routed and simple, and ranks
  before every fallback one; a synthetic network where the *only* routable
  loop is non-simple ranks it above every fallback suggestion but the result
  still reports `simple: false` on it; when *no* candidate in the pool can
  form a loop at all, the returned list matches Phase 6's own output (same
  suggestions, no `.loop`) — i.e. the graceful-fallback path reproduces
  Phase 6 exactly; progress yields are monotonic across both `phase`s and end
  with `done === total` on the final `phase: 'route'` step.
- **`match/loopSearch` (real data, may be marked slow)**: with the real
  bundled street data, graph, and index and a real circuit at 1:1, the search
  completes under a generous CI time budget and returns 1–`LOOP_RESULT_COUNT`
  suggestions; report how many are routed and, of those, how many are simple,
  in the ROADMAP entry.
- **`app/suggest` — `createLoopSuggester`**: mirrors the existing
  `createSuggester` tests — resolves with the generator's return value,
  calls `onProgress` at least once with `done === total`, `cancel()` resolves
  `[]` with no dangling timer.
- **`app/state`**: `applyPlacement` with a `route` argument sets it (copied,
  not aliased); omitting it still clears the route as before.
- **`ui/controls`**: a suggestion with `.loop.simple` renders the closed-loop
  label; one with `.loop` but `simple: false` renders the retraces-a-street
  variant; one without `.loop` renders today's coverage label; all three
  still carry a working `data-role="suggest-use"` button.
- **`app/map` (jsdom)**: with `searchRoutedLoops` stubbed to return one routed
  and one fallback suggestion, **Use this** on the routed one sets both the
  overlay (`overlayLatLngs` output differs) and `routePointCount` (the seeded
  route); on the fallback one, only the overlay changes and the route stays
  empty; hovering the routed row draws a second dashed polyline that
  disappears when the row is un-hovered; `destroy()` cancels cleanly.

## Acceptance criteria

- `npm run dev`: **Suggest placements** on a bundled circuit shows, when
  Porto's streets allow it, at least one suggestion labelled with a real loop
  length and its deviation from the circuit shape in metres — not a coverage
  percentage — and using it seeds a route that visibly follows real streets
  all the way around, editable exactly like a hand-traced one. A suggestion
  that only connects by retracing a street reads visibly differently from one
  that doesn't, and always ranks below it.
- When no candidate in the pool can form a full loop, the list still shows
  Phase 6's old geometry-only suggestions rather than coming up empty.
- Hovering a routed suggestion previews its real loop on the map, dashed,
  without changing anything; leaving the row clears the preview.
- The search still makes no network request, only ever suggests inside the
  bundled Porto bbox, and is still fully cancellable mid-search.
- No suggestion is ever applied automatically; there is still no headline
  match score anywhere in the feature.
- `npm run test:run` and `npm run build` pass; the real-data timing and the
  routed/simple-vs-fallback figures are reported in the ROADMAP decision log.
- `docs/ROADMAP.md` (Phase 8 → `done`, dated decision-log entry, priority →
  next item) and `RELEASES.md` updated per the working method.

## Not in scope

- **A freeform shape-first graph search** (e.g. a beam search that bends a
  loop street-by-street to fit the circuit's turning function, rather than
  validating poses Phase 6's rigid translate+rotate search already found).
  Meaningfully harder and higher-risk; a later item if this phase's
  validate-what-Phase-6-found approach proves too limited on real Porto data.
- **Geometric self-intersection detection.** `simple` catches the common
  case — a loop that reuses one of *its own* street edges — cheaply, from the
  graph's own bookkeeping. It does not detect two *different* streets whose
  drawn geometry happens to cross on the map without sharing a graph node (a
  grade separation, or a rare simplification artefact) — the same known
  limitation Phase 7 already documents for the graph itself. Visible to the
  user on the map either way; judgement stays with them.
- **Routing preferences** (avoid unlit streets, prefer certain road types,
  one-way streets) — unchanged from Phase 7's own *Not in scope*.
- **Searching beyond the bundled Porto box**, any Overpass call, or searching
  over scale — unchanged from Phase 6's own *Not in scope*.
- **Matching the user's traced route** (or a freehand sketch) against the
  network — still a separate later item; `tryRouteLoop`'s machinery is
  reusable for it but the UX is a different design.
- **Persisting the routed loop as anything other than `SavedPlacement.route`**
  — no new stored shape, no `PLACEMENTS_SCHEMA_VERSION` bump.
