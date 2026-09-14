# Spec — Phase 15: Spatial-quota coarse search (guarantee whole-city representation, per circuit, no memory)

Status: `done`
Depends on: [phase-6-suggested-placements.md](phase-6-suggested-placements.md),
[phase-12-anchor-on-real-streets.md](phase-12-anchor-on-real-streets.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

> **This replaces an earlier draft of this spec** (a cross-circuit "avoid
> zones another circuit already claimed" session memory), rejected on
> explicit product direction: the search must consider the whole city for
> **every** circuit, independently, with no memory of other circuits and no
> circuit-specific state — a design that must keep working unchanged as more
> circuits are added later, without per-circuit rules. This version does
> that: the fix lives entirely inside one circuit's own coarse search, is
> pure and stateless, and needs nothing outside `match/search.ts`.

## Goal

A user comparing circuits noticed **Suggest placements**' top pick always
lands in the same small part of Porto (Aldoar/Boavista) regardless of
circuit. Investigated with real data (full numbers in the ROADMAP decision
log) before writing anything, in three rounds:

1. **Raising `wTurning`/`wProcrustes` up to 16×** barely moved the top pick
   (338 m → 96-626 m apart across circuits) — shape weight isn't the lever.
2. **Raising `coarseKeep` up to 256** (16× cost) didn't diversify it either —
   refine reliably converges back to the same neighbourhood's local optimum
   regardless of how wide the initial net is.
3. **Raising `diversityDistM` (Phase 12's own final-selection spread
   control) made things *worse*, not better** — counterintuitive, but
   explained by how the two-pass accept works: pass one requires a candidate
   to be far from **every** already-accepted one simultaneously, so a large
   threshold makes pass one fail almost immediately after the first pick, and
   the remaining slots fall through to pass two's plain-score fallback (no
   distance constraint at all) — which just refills from the same favoured
   neighbourhood. Measured: hungaroring's within-circuit spread fell from
   4687 m (today's 800 m default) to 800 m flat at `diversityDistM ≥ 4000`.

**The actual cause, confirmed by directly inspecting the coarse sweep**: a
full grid scan found **146-159 coarse cells clearing `MIN_COVERAGE`, spread
across 8.7 km of the bundled bbox's 9.5 km width** — genuine, wide geographic
diversity of *viable* candidates already exists in the data. Bucketed into
~2 km macro-cells, that's **13-16 distinct regions of Porto with at least one
candidate that clears the coverage floor**, for every bundled circuit. But
`coarseKeep`'s plain "top 16 by score, globally" selection — the step that
decides which candidates ever reach local refine — **occupies only 3-4 of
those 13-16 regions**, every time, for every circuit: the best-scoring
region's own internal variation (different sub-cells, different rotations
within the same ~1.5-2 km neighbourhood) is enough on its own to fill most or
all of `coarseKeep`'s 16 slots, before a single candidate from most other
regions ever gets a chance to be refined, deduped, or considered by Phase
12's diversity pass — which only ever operates on whatever survived this
much earlier, much narrower cut.

This phase fixes coarse-keep itself: instead of the flat top-16 by score,
**guarantee at least one candidate from every macro-cell that has one**, up
to the existing `coarseKeep` budget. Pure function of one circuit's own
scored candidates against the bbox — no session state, no circuit identity
involved, no dependency on any other search ever run.

## How it stays true to the vision

- **Every circuit is searched the same way, independently, always.** No
  memory, no ordering effects, no per-circuit special-casing — the exact
  property requested. Adding a fourth, fifth, or fiftieth circuit later needs
  no change here: the mechanism only looks at the current circuit's own
  scored candidates and the bbox's fixed geometry.
- **Judgement stays with the user.** This does not hide the objectively
  best-fitting spot, nor force it out of the #1 rank — it only guarantees the
  *pool that reaches refine and final selection* is not, by construction,
  blind to 10+ other legitimately-viable parts of the city. The user still
  sees and picks from real, scored options; a circuit whose best fit
  genuinely is Aldoar/Boavista can still show that as its top suggestion.
- **No knob-turning without evidence.** Three existing tuning knobs
  (`wTurning`/`wProcrustes`, `coarseKeep`, `diversityDistM`) were tried and
  measured — two did nothing, one made it worse — before concluding the fix
  has to change *which* candidates are structurally eligible to be found at
  all, not how the eligible ones are weighted or spread afterwards.

## Vocabulary

- **Macro-cell** — a fixed-size (`spreadCellM`) square bucket of the search
  bbox, independent of the finer `coarseGridM` grid the coarse sweep already
  scores candidates on. Purely geometric, computed the same way for every
  circuit.
- **Macro-cell winner** — the highest-scoring coarse candidate (grid-sweep or
  Phase 12 straight-anchored seed) whose anchor falls inside a given
  macro-cell, among those clearing `minCoverage`.

## Decisions locked for this phase

- **`coarseKeep`'s selection becomes spatial-quota, not flat top-N.** Today
  ([search.ts:115-116](../../src/match/search.ts)):
  ```ts
  coarse.sort((a, b) => b.score.score - a.score.score)
  const kept = coarse.slice(0, o.coarseKeep)
  ```
  Becomes: bucket every scored `coarse` candidate (grid sweep **and**
  Phase 12's straight-anchored seeds — same merged array as today, no
  separate code path) into macro-cells by `floor(anchorM / spreadCellM)`,
  keep only the best-scoring candidate per macro-cell, sort those macro-cell
  winners by score, and take the top `coarseKeep` of *them*. If the number of
  occupied macro-cells is smaller than `coarseKeep` (a small bbox, or a
  circuit with few viable spots), every occupied macro-cell's winner is kept
  — never padded with a second candidate from an already-represented cell,
  since that would silently reintroduce today's concentration.
- **`spreadCellM` starting value: `2000`** (2 km) — chosen from the real-data
  investigation, where it produced 13-16 distinct macro-cells across the
  bundled bbox for all three circuits, a sensible match for the existing
  `coarseKeep = 16` budget. Tuned further during implementation if needed,
  real numbers reported in the ROADMAP decision log like every other
  constant.
- **Refine, dedup, and Phase 12's existing two-pass diversity accept are
  unchanged.** This phase only changes which candidates survive to reach
  them. Phase 12's `diversityDistM` pass still does useful work after this
  change (suppressing near-duplicate *refined* results that drifted close to
  each other, e.g. two macro-cells' winners refining toward a shared
  boundary street) — it is not redundant, just no longer the only thing
  standing between the user and a single-neighbourhood result list.
- **No new `SearchInput`/`SearchOptions` field for identity or memory** — the
  only new option is `spreadCellM`, a plain geometric tuning constant like
  `coarseGridM`, with the same "falls back to the spec default" contract as
  every existing option.
- **Straight-anchored seeds (Phase 12) participate in the same bucketing**,
  not a separate pass — a seed placing the circuit's straight onto a real
  street far from the grid sweep's favoured neighbourhood now has a real
  chance to *be* its macro-cell's winner (today it competes on raw score
  against the same neighbourhood's grid cells and mostly loses before
  `coarseKeep` even looks at geography), which is expected to make Phase 12's
  seeding materially more effective than it could be under flat top-16.

## Repository layout after this phase

```text
src/
├── match/
│   ├── types.ts        # + SearchOptions.spreadCellM
│   ├── search.ts        # coarse-keep: spatial-quota selection replaces flat top-N
│   └── search.test.ts   # extended
```

`match/objective.ts`, `match/straights.ts`, `graph.ts`, `streets.ts`,
`app/map.ts`, `ui/controls.ts` unchanged — this phase changes one selection
step inside `searchPlacements`, nothing about scoring, rendering, or app
state.

## New / changed code

### `src/match/types.ts`

```ts
export type SearchOptions = Partial<{
  // ...existing fields...
  /** Phase 15: macro-cell size (metres) for spatial-quota coarse-keep — at
   *  least one candidate per occupied macro-cell survives to refine, up to
   *  `coarseKeep`, instead of a flat top-N by score. */
  spreadCellM: number
}>
```

### `src/match/search.ts`

```ts
// --- Coarse sweep --------------------------------------------------------
// ...unchanged: coarse array filled by straight-anchored seeds + grid sweep...

// --- Spatial-quota keep ---------------------------------------------------
// Replaces flat "sort by score, slice(0, coarseKeep)": bucket into
// spreadCellM macro-cells, keep each occupied cell's best-scoring candidate,
// then take the top coarseKeep of those winners by score. Guarantees the
// pool reaching refine represents every macro-region of the bbox that has
// *any* viable candidate, instead of letting one region's internal variation
// fill the whole budget.
const macroWinners = new Map<string, Scored>()
for (const c of coarse) {
  const mx = Math.floor(c.candidate.anchorM[0] / o.spreadCellM)
  const my = Math.floor(c.candidate.anchorM[1] / o.spreadCellM)
  const key = `${mx},${my}`
  const existing = macroWinners.get(key)
  if (!existing || c.score.score > existing.score.score) macroWinners.set(key, c)
}
const kept = [...macroWinners.values()]
  .sort((a, b) => b.score.score - a.score.score)
  .slice(0, o.coarseKeep)
```

(Sketch — implementer may inline or factor this differently; the contract is
"at most one candidate per macro-cell reaches `kept`, occupied cells ranked
by their own best score, capped at `coarseKeep`total".)

`DEFAULT_SEARCH_OPTIONS` gains `spreadCellM: 2000`.

## Constants

| name | starting value | meaning |
| --- | --- | --- |
| `spreadCellM` | `2000` | macro-cell size for spatial-quota coarse-keep |

Starting point from the real-data investigation above; re-tuned during
implementation if the shipped number needs adjusting, reported honestly in
the ROADMAP decision log either way.

## Tests

- **`match/search.test.ts`**:
  - A synthetic bbox with one dense cluster of high-scoring candidates in one
    macro-cell and several lower-but-viable candidates each in their own,
    separate macro-cell: today's flat top-`coarseKeep` would fill entirely
    from the dense cluster (regression-guard test, asserting *this* is what
    the old behaviour did); after this phase, `kept` contains at most one
    candidate per macro-cell and includes winners from the separate cells,
    not just the dense one.
  - A macro-cell with only one viable candidate contributes exactly that one;
    an empty macro-cell contributes nothing (never padded).
  - Fewer occupied macro-cells than `coarseKeep`: every occupied cell's
    winner is kept, no duplicates fill the remaining budget.
  - Straight-anchored seeds (Phase 12) landing in an otherwise-unrepresented
    macro-cell can become that cell's winner and reach `kept` — a synthetic
    case where a seed's macro-cell has no competitive grid-sweep candidate at
    all confirms the seed alone is enough.
  - End-to-end: the planted-optimum test this module already has still
    finds the planted pose (regression guard that spatial-quota doesn't
    break the core search contract).
- **Real data**: extend the existing real-data search test to log, per
  bundled circuit, how many distinct macro-cells the final result list's 5
  suggestions occupy, and the top-pick's macro-cell — for a direct
  before/after comparison against this investigation's baseline (today: 3-4
  of 13-16 regions ever reach `kept` at all).

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run dev`: **Suggest placements** for each bundled circuit, run
  independently (no other circuit touched first, confirming statelessness),
  shows candidates drawn from visibly different parts of the bundled bbox,
  not variations of one neighbourhood.
- **The real-data bar**: for every bundled circuit, the number of distinct
  macro-cells represented in the pool that reaches refine (`kept`) is
  materially higher than today's 3-4 — expect it to track the "occupied
  macro-cell" count found in this spec's own investigation (13-16), capped by
  `coarseKeep`. Report the real number per circuit in the ROADMAP decision
  log; if a circuit's own data genuinely limits it below that (the way
  catalunya's 12-vs-39/46 matching-street count already limited Phase 12's
  spread), record the honest number rather than force it.
- No regression in per-candidate quality: every accepted suggestion still
  clears `MIN_COVERAGE`, and the planted-optimum regression test still
  passes — spatial-quota changes *which* candidates compete, never lowers
  the bar any individual one has to clear.
- `docs/ROADMAP.md` updated per the working method: Phase 15 → `done`, dated
  decision-log entry with the real macro-cell-representation numbers
  before/after, "Current priority" moved on.

## Not in scope

- **Any cross-circuit memory, session state, or `circuitId`-keyed logic** —
  explicitly rejected direction for this problem; the fix is entirely inside
  one circuit's own stateless search.
- **Changing `coverage`, `turningDistance`, `procrustesResidual`, or their
  weights** — tested and shown not to be the lever for this problem.
- **Changing `diversityDistM`, `dedupDistM`, or `coarseKeep`'s own value** —
  `coarseKeep` stays a budget (how many macro-cell winners survive), not a
  raw candidate count; `diversityDistM` was tested and shown to make things
  worse at higher values, so it stays at its current default, doing the
  narrower job (near-duplicate suppression after refine) it already does
  well.
- **Freeing the map beyond the bundled Porto bbox** — the existing, larger,
  separately-scoped "Later" roadmap item; this phase makes better use of the
  bbox the app already has, not a bigger one.
