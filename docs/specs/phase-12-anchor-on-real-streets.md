# Spec — Phase 12: Anchor candidates on real streets (longest-straight matching + geographic diversity)

Status: `done`
Depends on: [phase-6-suggested-placements.md](phase-6-suggested-placements.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phase 6's search sweeps a coarse translation+rotation grid over the whole
bbox, scores every cell, keeps the top `coarseKeep` by score, and locally
refines around each. This was flagged as an open question on 2026-09-11
("Phase 6 suggestions look clustered in one part of the bbox") and confirmed
by later real-world use: on the bundled circuits, most or all of the final 5
suggestions end up in the same small part of Porto — usually wherever the
coarse grid's raw coverage score happens to peak — even though other, quite
different parts of the city might make a perfectly plausible (if
lower-scoring by this particular metric) home for the circuit. The dedup step
(`dedupDistM`/`dedupRotDeg`) only removes *near-duplicates*; it does nothing
to encourage the final list to actually span the city.

This phase adds a second way to *propose* a candidate, alongside the existing
blind grid sweep: seed candidates directly from real streets whose own
longest straight run is close in length to the circuit's longest straight —
the single most load-bearing feature of a circuit's shape, and, per the
user's own observation, exactly what a runner scanning a real street map
would look for first ("does a street around here run about as long and
straight as this circuit's back straight?"). Matching real streets exist all
over Porto, not clustered in one neighbourhood, so seeding from them is
expected to naturally diversify results — and a final selection step adds an
explicit preference for spreading accepted suggestions across the map, so a
handful of high-scoring poses in one neighbourhood can no longer crowd out
every other part of the city.

## How it stays true to the vision

- **"Move and rotate the overlay by hand to find a plausible location"** —
  this phase automates the same reasoning a runner does by hand: find a real
  street about the right length and lay the circuit's straight along it. It
  proposes more, and more varied, plausible starting points; it does not
  replace the user's own judgement about which one to run.
- **Judgement stays with the user; no automated match score.** Straight-length
  matching and the diversity rule change which candidates get *proposed* and
  how the final list is *spread out* — every candidate is still scored and
  presented the same way (coverage %, deviation, or a routed/best-effort loop
  per Phase 8/10), and the user picks.
- **Static and offline; no new dependency.** Reuses the already-bundled street
  data and the existing `longestStraight` geometry utility (already used for
  the circuit's own "Longest straight" readout) and the existing refine/dedup
  machinery — no new library, no runtime fetch.

## Vocabulary

- **Circuit straight** — the circuit's own longest straight, already computed
  once per circuit as `MetricCircuit.longestStraight` (Phase 1): a length and
  a pair of centreline points, in the circuit's local (centroid-at-origin,
  unscaled) frame.
- **Street straight** — the longest near-straight run within a single bundled
  street `way`, found the same way (`geometry/straight.ts`'s `longestStraight`,
  `closed: false`): a length, a bearing, and a start/end point pair.
- **Matching street straight** — a street straight whose length, scaled
  against the circuit straight's length, falls within
  `[MIN_STRAIGHT_RATIO, MAX_STRAIGHT_RATIO]`.
- **Straight-anchored candidate** — a `Candidate` (anchor + rotation) placing
  the circuit so its own straight's midpoint and bearing line up with a
  matching street straight's midpoint and bearing (tried both ways along the
  street, since a straight's bearing is direction-agnostic).
- Reuses **candidate**, **coarse sweep**, **refine**, **dedup** (Phase 6)
  unchanged in meaning.

## Decisions locked for this phase

- **Straight-anchored seeds are added to the coarse pool, not a replacement
  for it.** `searchPlacements` still runs its existing grid sweep; this phase
  adds a second seeding pass that scores one (or two, see below) candidates
  per matching street straight the same way (`scoreCandidate`) and merges
  them into the same `coarse` array before the existing `coarseKeep`/refine
  step. A circuit whose straight has no real match anywhere in the bbox (or
  none at all — e.g. an unusually short or absent straight) degrades to
  exactly today's grid-only behaviour, never worse.
- **Two candidates per matching street straight**, not one: the circuit can
  run either direction along a real straight, so both the street straight's
  bearing and its reverse (`bearing + π`) are tried, each placing the
  circuit's straight midpoint at the street straight's midpoint. Both are
  scored independently by the existing `scoreCandidate`; a bad fit (e.g. the
  rest of the circuit's shape doesn't sit on streets going one way) scores
  low and is naturally dropped by the existing `minCoverage`/ranking, exactly
  like any other coarse candidate.
- **Matching band: `MIN_STRAIGHT_RATIO = 0.6`, `MAX_STRAIGHT_RATIO = 1.6`** —
  a real street straight between 60% and 160% of the circuit's own straight
  length counts as a match. Consistent with this codebase's existing use of
  ratio bands for "close enough" length tolerances (`MAX_LENGTH_RATIO`,
  `LENGTH_TOLERANCE`) rather than a fixed metre tolerance that would behave
  differently at different circuit scales.
- **Per-way straight detection, not graph-edge-merged.** Each bundled `Street`
  (a raw OSM way) is checked independently via `longestStraight`. A real
  avenue that OSM happened to split into several ways at an untagged bend-free
  point could be under-detected (each piece's own straight looks shorter than
  the true continuous street) — a conservative miss, not a wrong answer;
  documented under Not in scope rather than fixed here, to keep this phase to
  a single new data dependency (`network.ways`, already loaded) instead of
  also depending on `graph.ts`'s internal edge geometry.
- **Diversity in final selection: a two-pass accept loop.** After scoring and
  before truncating to `resultCount`, sorted candidates are accepted in score
  order same as today, but a candidate within `diversityDistM` of an
  *already-accepted* one is skipped in a first pass that only fills up to
  `resultCount` slots this way; a second pass then fills any slots still
  empty from the remaining candidates in plain score order, ignoring
  distance — so a circuit with genuinely only one good spot in Porto still
  gets `resultCount` suggestions exactly as today (this pass can only ever
  add candidates, never leave a slot empty that today's logic would have
  filled). `diversityDistM` defaults to `800` (metres) — comfortably larger
  than `dedupDistM` (200 m, "is this the same spot"), meant to answer
  "is this a genuinely different part of town", not to be a stricter
  near-duplicate filter.
- **`SearchInput` gains two new fields**, both supplied by the existing
  caller (`app/map.ts`'s `onSuggest`, which already has both values in
  scope): `ways: readonly Street[]` (for street-straight detection) and
  `circuitStraight: { a: Point; b: Point; lengthM: number }` (the circuit's
  own straight's two endpoints and length, pulled from
  `circuit.longestStraight` + `circuit.metricCentreline` once, before the
  search runs) — keeping `match/` decoupled from `circuits.ts`'s types, the
  same layering it already has today.

## Repository layout after this phase

```text
src/
├── match/
│   ├── types.ts                   # + SearchInput.ways, SearchInput.circuitStraight, SearchOptions.diversityDistM
│   ├── straights.ts               # new: findMatchingStreetStraights, seed candidate from a match
│   ├── straights.test.ts          # new
│   ├── search.ts                  # + straight-anchored seeding, diversity accept pass
│   └── search.test.ts             # extended
├── app/
│   └── map.ts                     # onSuggest passes ways + circuitStraight into SearchInput
```

`objective.ts`, `loopSearch.ts`, `graph.ts`, `streets.ts`, `ui/controls.ts`,
`state.ts` unchanged.

## New / changed code

### `match/straights.ts` (new)

```ts
import { longestStraight } from '../geometry/straight'
import type { Point } from '../geometry/types'
import type { Street } from '../streets'

export const MIN_STRAIGHT_RATIO = 0.6
export const MAX_STRAIGHT_RATIO = 1.6

export type StreetStraight = { a: Point; b: Point; lengthM: number; bearing: number }

/** Every bundled street's own longest straight run whose length, relative to
 *  `targetLengthM`, falls within `[MIN_STRAIGHT_RATIO, MAX_STRAIGHT_RATIO]`. */
export function findMatchingStreetStraights(
  ways: readonly Street[],
  targetLengthM: number,
): StreetStraight[]

/** The two candidate poses (bearing, and its reverse) that place
 *  `circuitStraight`'s midpoint and bearing onto `streetStraight`'s. */
export function seedFromStraight(
  circuitStraight: { a: Point; b: Point },
  streetStraight: StreetStraight,
): [Candidate, Candidate]
```

### `match/types.ts`

```ts
export type SearchInput = {
  circuitSamplesM: readonly Point[]
  scale: number
  index: StreetIndex
  bbox: MetricBounds
  /** Phase 12: raw street ways, for matching real straights against the
   *  circuit's own longest straight. */
  ways: readonly Street[]
  /** Phase 12: the circuit's own longest straight, local frame. */
  circuitStraight: { a: Point; b: Point; lengthM: number }
}

export type SearchOptions = Partial<{
  // ...existing fields...
  /** Minimum separation (metres) between accepted suggestions before falling
   *  back to plain score order to fill remaining slots. */
  diversityDistM: number
}>
```

### `match/search.ts`

- Before the coarse grid loop, call `findMatchingStreetStraights(input.ways,
  input.circuitStraight.lengthM * input.scale)`, then for each match call
  `seedFromStraight`, score both resulting candidates with the existing
  `scoreCandidate`, and push any clearing `minCoverage` into the same
  `coarse` array the grid sweep fills — same shape (`Scored`), same
  downstream `coarseKeep`/refine treatment, no special-casing later in the
  pipeline.
- The final accept loop (today: sort by score, dedup, take `resultCount`)
  becomes two passes over the same sorted, deduped list: pass one skips a
  candidate within `diversityDistM` of an already-accepted one; pass two
  (only if slots remain) takes the next-best remaining candidates regardless
  of distance.

### `app/map.ts`

`onSuggest`'s `SearchInput` literal gains:

```ts
ways: network.ways,
circuitStraight: {
  a: circuit.metricCentreline[circuit.longestStraight.startIndex]!,
  b: circuit.metricCentreline[circuit.longestStraight.endIndex]!,
  lengthM: circuit.longestStraight.lengthM,
},
```

## Constants

- `MIN_STRAIGHT_RATIO = 0.6`, `MAX_STRAIGHT_RATIO = 1.6` (`match/straights.ts`).
- `diversityDistM` default `800` (`match/search.ts`'s
  `DEFAULT_SEARCH_OPTIONS`), overridable like every other search knob.

## Tests

- **`straights.test.ts` `findMatchingStreetStraights`**: a set of synthetic
  ways of varying straight length returns only those inside the ratio band;
  a way with no near-straight run at all (constant sharp turns) is excluded;
  an empty `ways` list returns `[]`.
- **`straights.test.ts` `seedFromStraight`**: the two returned candidates
  place the circuit straight's midpoint exactly on the street straight's
  midpoint (within floating-point tolerance) and its bearing exactly on the
  street straight's bearing and its reverse, respectively.
- **`search.test.ts`**: a synthetic bbox where the grid sweep alone would
  under-score a distant-but-plausible spot, but a real street there matches
  the circuit's straight length — confirm a straight-anchored seed surfaces
  it in the final results where a grid-only search would have missed it; a
  scenario with two well-scoring clusters closer than `diversityDistM` apart
  confirms the final list includes a candidate from each cluster rather than
  several near-duplicates from the higher-scoring one, while a scenario with
  only one plausible area still returns `resultCount` suggestions (pass two
  filling the remainder).
- **Real data**: extend the existing real-data search test to log, per bundled
  circuit, how many straight-anchored seeds were found and the resulting
  suggestions' spread (e.g. bounding box or pairwise distance of the final 5
  anchors), for a before/after comparison against the clustering noted in the
  2026-09-11 open question.

## Acceptance criteria

- `npm run test:run` and `npm run build` pass.
- The real-data test/decision-log entry shows the bundled circuits' final
  suggestions spread across more of the bbox than before this phase (the
  concrete numbers recorded in the ROADMAP decision log), resolving the
  2026-09-11 open question — moved to Resolved once confirmed.
- `npm run dev`: **Suggest placements** for a bundled circuit no longer places
  every row in the same small neighbourhood, visually confirmed by the user
  per VISION's "judgement stays with the user" principle.
- A circuit with no real matching straight anywhere in the bbox still returns
  suggestions exactly as it does today (grid-only fallback, never worse).

## Not in scope

- **Merging artificially-split OSM ways** before straight detection (see the
  per-way decision above) — a documented conservative limitation, revisit
  only if real-data results look meaningfully short-changed by it.
- **Straightening the loop once placed** — that is
  [phase-11-straighten-best-effort-loops.md](phase-11-straighten-best-effort-loops.md),
  a separate lever (how well the loop follows streets once placed, not where
  it's placed).
- **Matching secondary shape features** (e.g. the second-longest straight, a
  characteristic corner radius) — this phase only anchors on the single
  longest straight, the strongest and simplest signal; other features are a
  possible later refinement if straight-only anchoring still misses obviously
  good spots.
- **Changing `coarseGridM`/`coarseRotDeg`/`coarseKeep` or any other existing
  Phase 6 grid-sweep constant** — the grid sweep is untouched; this phase only
  adds a second source of seeds into the same pipeline.
- **A UI control to disable/tune diversity** — `diversityDistM` is a search
  option like any other, not user-facing in this phase.
