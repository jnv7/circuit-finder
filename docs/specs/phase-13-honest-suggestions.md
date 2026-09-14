# Spec — Phase 13: Retire the routed/best-effort loop from Suggest placements

Status: `todo`
Depends on: [phase-6-suggested-placements.md](phase-6-suggested-placements.md),
[phase-8-routed-loop-suggestions.md](phase-8-routed-loop-suggestions.md),
[phase-10-best-effort-routed-loops.md](phase-10-best-effort-routed-loops.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md),
[../reviews/2026-09-13-suggested-placements-review.md](../reviews/2026-09-13-suggested-placements-review.md)

> **Sequencing.** This phase must ship — `match/loopSearch.ts` actually
> deleted, not just unwired — before
> [phase-14](phase-14-corner-anchored-placement.md) starts. Phase 14 builds a
> **different paradigm** (many independently-adjusted corner anchors) on top
> of `graph.ts` directly; it is not an extension of `tryRouteLoop` /
> `buildBestEffortLoop` / `searchRoutedLoops`, and must not import or reuse
> any of them. Deleting them here, rather than leaving them unused "just in
> case", is what makes that boundary unambiguous for whoever picks up Phase
> 14 next — there is no old rigid-loop code left in the tree to be tempted
> back into service.

## Goal

The 2026-09-13 independent review found that **Suggest placements**, as
shipped through Phase 12, never actually finds a real closed loop: across all
three bundled circuits, every run returns `routedCount: 0`, and the
"best-effort" fallback it shows instead is 1.4×–2.24× the circuit's real
length with 17–48% of its length invented as straight lines cutting across
blocks (see the review for the full evidence, including screenshots). This is
not a tuning shortfall — Phases 7 through 12 already spent six careful,
well-tested phases trying to close that gap and the routed count never moved
off zero.

This phase stops the app from presenting that result as if it were a route to
run. It does **not** delete the underlying street graph, routing, or
connectivity-repair code (`graph.ts` is correct and is exactly what
[phase-14-corner-anchored-placement.md](phase-14-corner-anchored-placement.md)
builds on next) — it retires the specific idea of validating a *rigid,
undeformed* circuit outline as a literal closed street loop, because that idea
has been tried and has a demonstrated ceiling. What it deletes is the code
that only existed to serve that idea: `match/loopSearch.ts` and its
`RoutedSuggestion`/`RoutedLoop`/`BestEffortLoop` types, which become genuinely
dead once nothing calls them.

After this phase, **Suggest placements** goes back to exactly what Phase 6
shipped: a ranked list of candidate spots, labelled honestly with street
coverage and deviation, never claiming to be a runnable loop. Phase 12's
straight-anchoring and diversity improvements (`match/straights.ts`,
`search.ts`'s two-pass accept) are unaffected — they still improve *which*
candidates get proposed, which stays useful on its own.

## How it stays true to the vision

- **"Judgement stays with the user; no automated match score."** A feature
  that hands the user a 9 km tangle for a 4.3 km circuit and calls it "best
  effort" has, in practice, replaced the user's judgement with a
  confidently-wrong one. Reverting to Phase 6's honest coverage percentage
  restores the original contract: a shortcut to a promising starting position,
  not a verdict.
- **"A 2 km straight is a ~2 km straight."** Best-effort loops violate this on
  every single bundled circuit, every run. Removing them from the default
  path removes the only place in the app that currently breaks this
  principle.
- **Functional first; no unused code.** `match/loopSearch.ts` is
  well-engineered and well-tested, but once nothing in the default flow calls
  it, keeping it "just in case" is exactly the kind of speculative,
  unused abstraction CONVENTIONS.md's spirit argues against. It is not lost —
  it stays in git history — but it does not linger in the tree unused.

## Decisions locked for this phase

- **`app/map.ts` switches from `createLoopSuggester()` back to
  `createSuggester()`** (both already exist in `app/suggest.ts`;
  `createSuggester` has been unused by the app, but still tested, since Phase
  8). `onSuggest`'s search call becomes `active.run(input, onProgress, opts)`
  — no `streetGraph` argument, no `phase: 'search' | 'route'` distinction.
- **`ui/controls.ts`'s `SuggestView.suggestions` becomes
  `readonly Suggestion[]`**, not `RoutedSuggestion[]`. `formatSuggestionLabel`
  drops the `s.loop` / `s.bestEffort` branches entirely — only the existing
  coverage-percentage branch remains (`"NN% on streets · ~NN m avg"`), so the
  function collapses to what it was before Phase 8.
- **`onUseSuggestion` no longer seeds a route.** `applyPlacement(state,
  chosen.placement)` — drop the `chosen.loop?.points ?? chosen.bestEffort
  ?.points ?? []` lookup and the `route` argument entirely (its default `[]`
  already does the right thing). A suggestion sets a placement; tracing a real
  route, manually or via Phase 14 once it ships, is a separate, later step.
- **Delete outright** (not deprecate, not leave unused):
  - `src/match/loopSearch.ts` and `src/match/loopSearch.test.ts`.
  - `RoutedLoop`, `BestEffortLoop`, `RoutedSuggestion`, `LoopSearchProgress`,
    `LoopSearchOptions` from `src/match/types.ts`.
  - `createLoopSuggester` and the `LoopSuggester` type from
    `src/app/suggest.ts` (`pump`, `createSuggester`, `Suggester` stay — still
    used).
  - The `GAP_COLOR`/`previewGapLine`/`routeGapLine` wiring in `app/map.ts`
    **stays** — manual tracing (`expandRouteWithGaps`, Phase 7/10) still
    legitimately draws gaps for a *hand-traced* route the graph can't fully
    connect; only the suggestion-preview gap layer
    (`previewGapLine`/`previewRouteLine`'s loop-leg-preview role) goes, since
    nothing produces `RoutedSuggestion.loop`/`.bestEffort` any more.
- **`app/map.ts`'s render() preview logic simplifies**: the
  `previewLegs`/`toLegLatLngs(previewLegs...)` block
  ([map.ts:299-308](../../src/app/map.ts)) that draws a hovered suggestion's
  loop/best-effort legs is deleted along with `previewRouteLine` /
  `previewGapLine`; hovering a (now plain `Suggestion`) row goes back to
  Phase 6's dashed-outline-only preview (reusing the existing
  `buckets`/dashed-style mechanism the saved-placement preview already uses,
  same as before Phase 8 introduced the loop preview).
- **No change to `match/search.ts`, `match/straights.ts`, `match/objective.ts`,
  `graph.ts`, `streets.ts`, or any Phase 6/12 constant.** This phase only
  changes what `app/map.ts` calls and what `ui/controls.ts` renders.

## Repository layout after this phase

```text
src/
├── match/
│   ├── types.ts              # RoutedLoop/BestEffortLoop/RoutedSuggestion/LoopSearchProgress/LoopSearchOptions removed
│   ├── loopSearch.ts         # DELETED
│   └── loopSearch.test.ts    # DELETED
├── app/
│   ├── suggest.ts            # createLoopSuggester + LoopSuggester removed; createSuggester/Suggester unchanged
│   ├── suggest.test.ts       # loop-suggester tests removed
│   ├── map.ts                # onSuggest/onUseSuggestion/render() revert to a plain Suggestion flow
│   └── map.test.ts           # loop/best-effort suggestion tests removed or rewritten against plain Suggestion
└── ui/
    ├── controls.ts           # SuggestView.suggestions: Suggestion[]; formatSuggestionLabel loses loop/bestEffort branches
    └── controls.test.ts      # loop/best-effort label tests removed
```

`match/search.ts`, `match/straights.ts`, `match/objective.ts`, `graph.ts`,
`graph.test.ts`, `streets.ts`, `app/trace.ts` unchanged. No new files, no new
dependency, no data file change.

## New / changed code

### `src/app/map.ts`

```ts
// before: let loopSuggester: LoopSuggester = createLoopSuggester()
let suggester: Suggester = createSuggester()
```

`onSuggest()`: build the same `SearchInput` as today (unchanged — `ways` and
`circuitStraight` still feed Phase 12's straight-anchoring), but call
`suggester.run(input, onProgress, opts)` — three arguments, no `streetGraph`,
no `.then` branch that re-labels only "fallback" suggestions (every
suggestion is now the same shape, so the existing re-label logic, currently
[map.ts:539-556](../../src/app/map.ts), applies uniformly to the whole list,
simplifying to a single `.map()` with no `if (s.loop) return s` branch).

`onUseSuggestion(index)`:

```ts
const chosen = suggest.suggestions[index]
if (!chosen) return
// ...same confirm-if-route-exists guard...
state = applyPlacement(state, chosen.placement)
```

`render()`: the suggestion-preview block goes back to reusing the existing
dashed-outline preview (the same mechanism `previewingSaved` already drives)
instead of `previewRouteLine`/`previewGapLine`. Concretely,
`previewSuggestion: Suggestion | null` (not `RoutedSuggestion`), and the
`shown`/`preview` computation at the top of `render()` already handles this —
no new code needed there, only deletion of the now-dead loop-leg block.

### `src/ui/controls.ts`

```ts
export type SuggestView = {
  phase: 'idle' | 'running' | 'results'
  progress?: SearchProgress          // was LoopSearchProgress
  suggestions: readonly Suggestion[] // was RoutedSuggestion[]
  selectedIndex: number | null
}

export function formatSuggestionLabel(s: Suggestion): string {
  const pct = Math.round(Math.max(0, Math.min(1, s.coverageFraction)) * 100)
  return `${pct}% on streets · ~${Math.round(s.meanDeviationM)} m avg`
}
```

The "Checking routes…" / "Searching placements…" phase label in
`renderSuggestSection` goes back to a single, unconditional "Searching
placements…" (no `p.phase === 'route'` branch — `SearchProgress` has no
`phase` field).

## Constants

None added or changed. `MIN_COVERAGE`, `W_TURNING`, `W_PROCRUSTES`,
`diversityDistM`, and every other Phase 6/12 constant keep their current
values.

## Tests

- **`app/suggest.test.ts`**: remove every `createLoopSuggester`/`LoopSuggester`
  test; `createSuggester`'s existing tests (already present, currently
  exercising code the app itself doesn't call) start covering the app's real
  path again — no new tests needed, just confirm they still pass.
- **`ui/controls.test.ts`**: remove the loop/`simple: false`/best-effort
  `formatSuggestionLabel` cases; keep and extend the plain coverage-percentage
  case. `renderSuggestSection`'s "running" test no longer asserts a
  phase-dependent label.
- **`app/map.test.ts`**: rewrite the suggestion-flow tests (mount → suggest →
  use) against plain `Suggestion` fixtures instead of `RoutedSuggestion` ones;
  drop any test asserting gap-leg or loop-leg preview rendering for a
  suggestion (manual-trace gap rendering tests, which are unrelated, are kept
  untouched).
- **No real-data test survives this phase** for the suggestion path beyond
  what `match/search.test.ts` already has (Phase 6/12's own real-data test,
  unaffected) — the loop-specific real-data test
  (`loopSearch.test.ts`'s "real Porto data" case, the one that produced this
  review's headline numbers) is deleted along with the module it tests.

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run dev`: **Suggest placements** for a bundled circuit shows up to five
  rows, each labelled `"NN% on streets · ~NN m avg"`, with no length, no gap
  count, and no "closed loop"/"retraces a street" wording anywhere.
- **Use this** on a row sets the placement and leaves `route` empty — tracing
  (manual, today; Phase 14, next) is a separate, explicit step the user takes
  afterwards.
- `grep -r "RoutedSuggestion\|RoutedLoop\|BestEffortLoop\|createLoopSuggester" src/`
  returns nothing.
- `docs/ROADMAP.md` updated per the working method: Phase 13 → `done`, a dated
  decision-log entry recording that `match/loopSearch.ts` was deleted and why
  (link this spec and the review), "Current priority" moved to Phase 14.
  `RELEASES.md` gets a user-facing entry: suggestions are now honestly labelled
  starting spots, not routes.

## Not in scope

- **Any new matching algorithm.** This phase only removes a feature that
  doesn't work; [phase-14](phase-14-corner-anchored-placement.md) is where the
  replacement is built.
- **Changing `SavedPlacement`'s schema** or anything persisted — no saved data
  depended on `RoutedSuggestion`.
- **Re-tuning Phase 6/12's search constants.** Untouched; if their current
  behaviour (coverage %, diversity) turns out to need adjustment, that is a
  separate, focused change with its own evidence, not bundled here.
