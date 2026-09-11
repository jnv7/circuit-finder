# Spec — Phase 10: Best-effort routed loops (mark the gaps, don't reject)

Status: `todo`
Depends on: [phase-8-routed-loop-suggestions.md](phase-8-routed-loop-suggestions.md),
[phase-9-graph-connectivity-repair.md](phase-9-graph-connectivity-repair.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phase 8's routed suggestions are all-or-nothing: every one of ~60 sample legs
around a candidate must connect by real street, and the total must stay under
`MAX_LENGTH_RATIO` (1.5×), or the whole candidate is thrown away. Phase 9
fixed a real connectivity bug (88.3% → ~95.3%) but — measured on the bundled
data — **still zero candidates clear that bar for any of the three circuits**.
Users see either a real routed loop or a bare coverage percentage; there is
nothing in between, even though most of a rejected candidate's legs usually
*do* connect — one or two just don't.

This phase adds a third kind of result that never fails: build the loop as
close to the circuit's shape as the street network allows, and where a leg
genuinely has no real street to follow, draw that one leg as a straight line
and **flag it, visibly, in red** — instead of silently patching it in (which
Phase 7/8 both refuse to do for exactly this reason) or rejecting the whole
candidate over it. The user sees precisely how much of the suggestion is real
street and how much is invented, and decides for themselves — the same
*judgement stays with the user* principle Phase 3's proximity colouring
already established, applied here to route construction instead of overlay
validation.

This directly answers the original complaint that started the Phase 8/9
work: a suggestion should read as *"a route in the city," not "a shape that
happens to overlap some streets."* A best-effort loop is exactly that — a
real route, honestly marked wherever it isn't.

## How it stays true to the vision

- **"Trace the actual running route along real streets, following the
  overlay"** (VISION.md) — this phase gets closer to that promise for
  *suggestions* than Phase 8 ever could on real data, by not discarding a
  95%-real loop over its worst leg.
- **Judgement stays with the user; no automated match score.** A best-effort
  loop reports plain facts — real length, deviation, how many legs and metres
  are invented — with no score deciding whether it's "good enough." The user
  looks at the red and decides.
- **No elevation, no silent patching.** The red marking *is* the point: Phase
  7 already quietly falls back to a straight line when it must (tracing) and
  Phase 8 refused to do that silently for suggestions. This phase keeps that
  refusal — it just stops treating "silent" and "shown" as the same choice.
- **Static and offline; no new dependency.** Built entirely from the already-
  bundled graph (Phase 7/9) and existing per-candidate machinery (Phase 6/8).

## Vocabulary

- **Real leg** — one stretch of a loop where `graph.shortestPath` found a
  real, connected route between the leg's two points.
- **Gap leg** — one stretch where it didn't (either point failed to snap, or
  the two didn't connect): drawn as a straight line between the two points
  actually used (the resolved street point where snapping succeeded, the raw
  placed point where it didn't), and flagged `real: false`.
- **Best-effort loop** — a closed loop built this way: every leg is real or
  gap, never silently merged, never rejected outright.
- Reuses **node**, **edge**, **graph** (Phase 7), **candidate**, **simple**
  (Phase 8) unchanged.

## Decisions locked for this phase

- **One shared join primitive, reused by tracing and suggestions.**
  `app/trace.ts`'s `expandRoute` already silently falls back to a straight
  line per leg for manual tracing (Phase 7) — it just never told the caller
  which legs those were. Replace it with `expandRouteWithGaps`, returning the
  per-leg real/gap split; `expandRoute`'s only caller (`app/map.ts`) updates
  to use it, and the drawn trace line — not just suggestions — now shows red
  wherever a click-to-click leg had no real street. One mechanism, two
  callers (manual trace, automatic suggestion), not two implementations.
- **`buildBestEffortLoop` never returns `null`.** Same inputs as `tryRouteLoop`
  (circuit samples, candidate pose, scale, graph), same `LOOP_SAMPLES`/
  `LOOP_SNAP_MAX_M` — but instead of failing on the first unresolved point or
  unconnected pair, it keeps going, calling `expandRouteWithGaps` under the
  hood for the join logic. No `MAX_LENGTH_RATIO` cap either: the real length
  is reported, not gated — a huge total or a huge gap count still comes back
  as a result, just an honestly bad-looking one, for the user to judge.
- **Ranking key: `gapLengthM` (ascending), not a pass/fail bar.** Between two
  best-effort loops, the one inventing fewer metres of "street" wins; deviation
  breaks ties. This replaces a binary cliff with a continuous ordering, which
  is the whole point of not rejecting on one bad leg.
- **Slots into `searchRoutedLoops`'s existing ranking, as a new tier.** Order
  becomes: simple routed (Phase 8, unchanged) → non-simple routed (unchanged)
  → **best-effort (new)** → Phase 6's bare coverage-percentage fallback (kept,
  now reached only if the candidate pool itself is exhausted before filling
  `loopResultCount` slots — a corner case, not the common path it is today).
  Same early-stop strategy as today: try the pool in geometric rank order,
  attempt `tryRouteLoop` then `buildBestEffortLoop` for each, stop once
  `loopResultCount` slots are filled. Not re-ranking the *entire* pool by
  `gapLengthM` globally — keeps this phase's compute cost close to today's
  (same number of route attempts as Phase 8/9 already make) rather than
  trying every pool candidate to find a global minimum.
- **Rendering: real legs in the existing preview/route style, gap legs in a
  distinct red dashed style.** Both the suggestion-hover preview and the
  drawn trace line become two Leaflet polylines instead of one — an unchanged
  "real" line plus a new "gap" line fed the gap legs' points as a multi-
  segment polyline (disjoint arrays, one per gap leg).
- **Adopting a best-effort suggestion seeds a plain traced route, same as
  Phase 8.** `AppState.route` keeps storing waypoints only (Phase 5's shape,
  unchanged) — gap information is never persisted, only recomputed at render
  time from whatever the current graph says. This is deliberate: it is the
  same *recompute, don't persist* pattern Phase 3 and Phase 7 already use,
  and it means gap marking stays correct even if the user edits the route
  afterwards (add/undo points) — there is nothing stale to invalidate.
- **No new data file, no new dependency, no change to `porto-streets.json`
  or `SavedPlacement`'s stored shape.**

## Repository layout after this phase

```text
src/
├── app/
│   ├── trace.ts                 # expandRoute → expandRouteWithGaps
│   ├── trace.test.ts             # extended
│   ├── map.ts                    # two-polyline rendering (real + gap)
│   └── map.test.ts               # extended
├── match/
│   ├── loopSearch.ts             # + buildBestEffortLoop, ranking tier
│   ├── loopSearch.test.ts        # extended
│   └── types.ts                  # + BestEffortLoop, RoutedSuggestion.bestEffort
├── ui/
│   ├── controls.ts               # formatSuggestionLabel handles bestEffort
│   └── controls.test.ts          # extended
```

`graph.ts`, `search.ts`, `objective.ts`, `streets.ts`, `state.ts` unchanged.

## New / changed code

### `app/trace.ts`

```ts
export type RouteLeg = { points: Point[]; real: boolean }

/**
 * Waypoints joined leg by leg: a real routed path where the graph connects
 * them, a straight line — flagged `real: false` — where it doesn't. Replaces
 * `expandRoute`, which did the same join but discarded which legs fell back.
 */
export function expandRouteWithGaps(
  waypoints: readonly Point[],
  graph: StreetGraph,
): { points: Point[]; legs: RouteLeg[] }
```

`routeLengthM` / `routeDeviation` / `routeStats` are unchanged — callers pass
`.points` exactly as they pass `expandRoute`'s result today.

### `match/types.ts`

```ts
/** Phase 10: a loop that always exists — every leg is a real routed street
 *  segment or, where the network doesn't cooperate, a straight "gap" segment,
 *  clearly flagged rather than silently included or the candidate rejected. */
export type BestEffortLoop = {
  legs: RouteLeg[]
  points: Point[]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  /** Straight-line length of every gap leg, metres — the ranking key. */
  gapLengthM: number
  gapCount: number
}

export type RoutedSuggestion = Suggestion & {
  /** A fully-connected loop (Phase 8). Mutually exclusive with `bestEffort`. */
  loop?: RoutedLoop
  /** A best-effort loop (Phase 10), present when no fully-routed loop was
   *  found for this candidate but a real attempt still exists. */
  bestEffort?: BestEffortLoop
}
```

### `match/loopSearch.ts`

```ts
/** Never null: joins the placed outline's samples leg by leg via `graph`,
 *  same inputs as `tryRouteLoop`, but keeps every leg — real or gap — instead
 *  of failing on the first miss, and reports the real total length with no
 *  `MAX_LENGTH_RATIO` cap. */
export function buildBestEffortLoop(
  circuitSamplesM: readonly Point[],
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { samples?: number; snapMaxM?: number },
): BestEffortLoop
```

`searchRoutedLoops`'s per-candidate loop: where it currently does
`if (loop) routed.push(...) else fallback.push(...)`, insert the new tier —
`if (loop) routed.push(...) else { const be = buildBestEffortLoop(...); bestEffort.push({...s, bestEffort: be}) }`
— filling `loopResultCount` slots from routed + bestEffort combined before
any candidate reaches the old bare `fallback` array. Final sort: simple
routed (by `meanDeviationM`), non-simple routed (same), best-effort (by
`gapLengthM` then `meanDeviationM`), fallback (original rank) — as above.

### `app/map.ts`

- `expandedRoute()` becomes `expandedRouteWithGaps()`, returning both the
  flattened points (for stats, unchanged call site) and the leg list.
- The drawn trace line and the suggestion hover-preview each become two
  Leaflet polylines: the existing style fed every real leg's points, and a
  new red dashed layer fed every gap leg's points as a multi-segment
  polyline. Adding `L.polyline([[...],[...]], {...})` (an array of arrays)
  draws disjoint segments in one layer — no per-leg layer management needed.
- `applyPlacement` on a best-effort suggestion seeds `AppState.route` from
  `bestEffort.points` exactly as a routed suggestion does from `loop.points`
  today — same flattening, same discard of any structure beyond the plain
  waypoint list.

### `ui/controls.ts`

`formatSuggestionLabel` gains a `bestEffort` branch between the existing
`loop` and bare-fallback cases:

```
"3.1 km loop · 2 street gaps (180 m) · ~14 m off shape"
```

(distance, gap count and total gap length, then deviation — a gap count of
zero cannot occur here since that candidate would already be a `loop`).

## Constants

No new tunable constants: `buildBestEffortLoop` reuses `LOOP_SAMPLES` and
`LOOP_SNAP_MAX_M` from Phase 8, and `searchRoutedLoops`'s existing
`loopCandidatePool` / `loopResultCount`.

## Tests

All offline, default vitest environment except the jsdom smoke tests.

- **`app/trace` `expandRouteWithGaps`**: three waypoints, all connected, real
  legs cover the whole route (`legs.every(l => l.real)`); a waypoint pair in
  disconnected components produces one `real: false` leg with exactly the two
  endpoints, others still real; the flattened `.points` matches what
  `expandRoute` used to return bit-for-bit (regression, since this replaces
  it).
- **`match/loopSearch` `buildBestEffortLoop`**: a fully-connected placed
  outline returns `gapCount: 0` and `gapLengthM: 0`; a candidate with one
  disconnected leg returns exactly one gap leg and the others real, `gapLengthM`
  equal to that leg's straight-line length; a candidate where *no* sample
  snaps at all still returns a full loop of gap legs (never throws, never
  null); never rejected for length — a huge `lengthM` still comes back.
- **`match/loopSearch` `searchRoutedLoops` ranking**: a scenario with one
  fully-routable candidate and one best-effort-only candidate ranks the
  routed one first; two best-effort-only candidates rank by `gapLengthM`
  ascending; a fully-disconnected network (no candidate routes or connects at
  all) still fills slots with best-effort loops before ever reaching the old
  bare fallback.
- **`ui/controls` `formatSuggestionLabel`**: the new best-effort branch reads
  distance, gap count/length, and deviation in the right order; a `loop`
  suggestion is unaffected (regression).
- **`app/map` (jsdom)**: a best-effort suggestion's hover preview draws both a
  real-leg line and a non-empty red gap line; using a suggestion whose best
  effort has one gap leg draws the adopted route with that same gap visibly
  red; a fully-connected manual trace (existing Phase 7 test scenario) draws
  no red line at all (regression — nothing changes for a trace with no gaps).
- **Real data**: extend Phase 9's real-data `searchRoutedLoops` test to also
  report, per circuit, how many best-effort suggestions were found and their
  gap counts/lengths — expect **every** bundled circuit to now return at
  least one suggestion with `bestEffort` set (a strictly weaker, always-
  achievable bar than Phase 9's routed one), logged in the ROADMAP decision
  log alongside the actual gap numbers.

## Acceptance criteria

- `npm run test:run` and `npm run build` pass.
- The real-data test reports every bundled circuit returning at least one
  best-effort suggestion, with real gap counts/lengths logged in the ROADMAP
  decision log — replacing today's all-coverage-percentage fallback list.
- `npm run dev`: **Suggest placements** for each bundled circuit shows at
  least one row reading like `"3.1 km loop · 2 street gaps (180 m) · ~14 m
  off shape"`; hovering it previews the real legs in the normal dashed style
  and the gap legs in red; **Use this** seeds an editable route whose drawn
  line shows the same red gaps.
- Manual **Trace route** (Phase 5/7, unrelated to suggestions) also shows red
  wherever a click-to-click leg has no real street — a visible improvement to
  an existing feature, not just new suggestion rows.
- No new dependency, no new data file, no change to `porto-streets.json`,
  `SavedPlacement`'s stored shape, or `PLACEMENTS_SCHEMA_VERSION`.

## Not in scope

- **A freeform, street-by-street search that bends the loop to the circuit's
  shape as it walks**, rather than validating/completing Phase 6's rigid
  poses. This phase still starts from Phase 6's geometric candidates; a
  genuinely different search strategy (choosing the next street to follow by
  local shape match, not just joining fixed sample points) is a larger,
  separate problem, noted here as a possible Phase 11 if best-effort loops
  still don't look close enough to the circuit's shape on real data.
- **Persisting gap information** in `SavedPlacement` or `AppState.route`. Gap
  status is always recomputed from the current graph at render time.
- **Changing `MAX_LENGTH_RATIO`, `LOOP_SNAP_MAX_M`, or any Phase 6/8 search
  constant.** This phase adds a new outcome tier; it does not retune the
  existing ones.
- **Editing a gap leg specially** (e.g. suggesting a manual detour around it).
  A gap is shown, not fixed — the user's own judgement (and Phase 5's
  existing add/undo/clear trace editing) is the only tool offered.
