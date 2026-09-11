# Spec — Phase 9: Street graph connectivity repair (crossing detection)

Status: `done` (shipped 2026-09-11 — see the ROADMAP decision log for the
real-data numbers and the new finding that drove the constant choice below)
Depends on: [phase-7-street-graph.md](phase-7-street-graph.md),
[phase-8-routed-loop-suggestions.md](phase-8-routed-loop-suggestions.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phase 8 shipped Phase 6's suggested placements validated as real, fully
street-connected loops — but on the bundled Porto data, all three circuits
(`hungaroring`, `silverstone`, `catalunya`) return **zero** routed
suggestions at 1:1 scale. Every suggestion shown today is still a Phase 6
geometry-only fallback: a shape that overlaps streets, with no guarantee any
two of those streets actually connect.

Investigation (see the ROADMAP decision log for this phase) found the cause
is **not** a genuine gap in Porto's street network, and **not** fixed by
loosening Phase 7's endpoint-merge tolerance (`NODE_MERGE_M`) — raising it
from 4m to 20m changed nothing: every one of the top-ranked candidate poses
for all three circuits still failed to route 4–15 of their 60 sample legs,
identically at both tolerances.

The real cause: Phase 7's connectivity repair only ever asks "does this way's
**endpoint** land near another way's endpoint or interior?". It never asks
"do these two ways **cross**, or run close alongside each other, somewhere in
their middle?" — the exact case created when Douglas–Peucker simplification
(independently per way, see `porto-streets.schema.md`) removes the shared
vertex at a real OSM junction from **both** ways because, looked at alone,
neither needs it to stay within its own 5m tolerance. Spot-checking two of
the largest disconnected fragments against live OSM data (Overpass) confirmed
real, connected streets exist there — a dense residential grid near Boavista
and the Ribeira/Ponte Luiz I hillside — that the bundled graph shows as
isolated islands.

Testing a segment-to-segment crossing check (with a small corridor width
around each street, motivated by real lane width) instead of the current
endpoint-only check raised the largest connected component from 88.3% to
**96.7%** with *no* width at all (pure geometric crossing detection), climbing
to 97.6–99.3% as a modest corridor width (3–15m) is added on top. This phase
builds that check into `graph.ts`.

**Post-implementation update.** The shipped version does exactly this, and
the real-data connectivity number it produces is real (88.3% → ~95.3%,
confirmed by `graph.test.ts`'s real-data test) — but the acceptance bar of
"at least one bundled circuit returns a routed suggestion" was **not**
reached at any corridor width honest enough to ship. Two things were learned
only once the fix existed to measure against:

1. **Connectivity alone wasn't the last blocker.** Even once a candidate's
   every leg connects, Phase 8's separate `MAX_LENGTH_RATIO` (1.5×) still
   rejects it — the real routed path between two points close in the
   circuit's shape often detours 1.5–2× their straight-line spacing in
   Porto's real (hilly, non-grid) layout. Pushing `CORRIDOR_M` up to 30–40m
   does eventually get some candidates under that cap, but:
2. **A wide corridor is not a safe knob.** At that width the same mechanism
   starts bridging things that are not the same street — most concretely,
   Phase 8's own `disconnectedQuad` test fixture (two street sides pulled 8m
   apart specifically to model "not connected") stopped being disconnected.
   That is the same failure mode as a false grade-separation merge, just
   easier to catch because it broke a test. It generalises: a 2D corridor
   test cannot tell "two ends of the same junction, just drawn apart by
   simplification" from "two genuinely different streets that happen to run
   8–40m apart" — and Porto has plenty of the second kind (parallel streets,
   footways beside roads, terraced hillside lanes).

`CORRIDOR_M` therefore ships at the spec's original conservative `6` — real,
verified, contained improvement, without gambling that width on a headline
number. The `MAX_LENGTH_RATIO` interaction is recorded here for whichever
phase looks at routed suggestions next; re-opening it is explicitly a
decision for that phase, not something this one talks itself into by
proxy via a bigger corridor. See the ROADMAP decision log for every number
behind this call.

## How it stays true to the vision

- **"Trace the actual running route along real streets, following the
  overlay"** (VISION.md) — Phase 7 made this true for hand-traced routes;
  this phase is what lets Phase 8's *suggestions* make the same promise
  routinely, instead of almost never.
- **Judgement stays with the user; no automated match score.** This phase
  changes nothing about scoring or ranking — it only makes more of Phase 8's
  already-built validation pipeline succeed on real streets that do, in fact,
  connect.
- **Repair by tolerance, not by touching the bundled data** — the same
  Phase 7 principle, extended with one more geometric test. No re-run of the
  OSM extraction pipeline, no new data file.
- **No elevation** (VISION.md non-goal) stays true — grade-separated
  crossings (bridges, viaducts) are a known, accepted blind spot of a
  purely-2D crossing test, handled pragmatically (see below), not by adding
  elevation data.

## Vocabulary

- **Corridor** — a street's centreline geometry treated as having a small
  fixed width either side, so a "connection" test asks whether two streets'
  corridors overlap anywhere along their length, not just whether their
  endpoints coincide.
- **Crossing** — two ways whose segments geometrically intersect (corridor
  width 0) or pass within `CORRIDOR_M` of each other at some interior point
  of both (not necessarily at either way's endpoint).
- Reuses **node**, **edge**, **graph** from Phase 7's vocabulary unchanged.

## Decisions locked for this phase

- **A third repair pass in `buildGraphCore`**, after Phase 7's existing two
  (endpoint merge, endpoint-into-interior split): for every pair of segments
  belonging to different ways that are not already in the same component,
  test true segment-to-segment distance (0 if they cross, otherwise the
  minimum of the four endpoint-to-opposite-segment distances). If it is
  `<= CORRIDOR_M`, split **both** ways at their closest approach (the actual
  intersection point if they cross; the midpoint of the two closest points
  otherwise) and merge the two new split-nodes into one, exactly like Phase
  7's existing split machinery — this phase extends that machinery to a
  second way, it does not replace it.
- **Grid-pruned, not all-pairs.** Reuse the existing segment-grid pattern
  (`buildSegmentGrid`) with cell size `~= CORRIDOR_M` so this stays a
  near-linear pass over the network's ~43k segments, not O(n²). Construction
  must stay within a few seconds on load (Phase 7's own graph build is
  already paid once at startup in `app/map.ts`; this phase's pass adds to
  that same one-time cost).
- **`CORRIDOR_M` ships at `6`** (≈ two lane-widths, i.e. the motivating "~3m
  per lane" halved on each side) — tried tuning it up during implementation
  (10, 15, 20, 30, 40m) chasing the "≥1 routed suggestion" bar, and rolled
  back: past about 8–10m the same mechanism that repairs real junctions
  starts bridging unrelated nearby streets (confirmed two ways: Phase 8's own
  `disconnectedQuad` test fixture, built to model "definitely not connected"
  at an 8m gap, started passing; and a real-data spot-check against OSM
  `bridge`/`viaduct` tags found hundreds of candidate false merges scaling up
  with corridor width). `6` is the point that stays inside "repairs a
  simplification artefact" without sliding into "connects things that
  weren't the same street" — see the post-implementation note above for what
  this did and didn't unlock.
- **Grade-separated false positives are a known, accepted limitation, handled
  by a short hardcoded exclusion list — not elevation data.** A 2D crossing
  test cannot tell a real junction from a bridge passing over another road.
  Porto's bundled bbox has a small, enumerable set of such crossings (the
  Douro bridges — Dom Luís I, Arrábida, Infante, São João/Maria Pia — plus
  wherever the Circunvalação is grade-separated). Implementation must spot-
  check the built graph against these specific locations and, if the new pass
  wrongly merges any of them, add their approximate `[lon, lat]` crossing
  point to a small exclusion list in `graph.ts` that skips the corridor merge
  within `EXCLUDE_RADIUS_M` of a listed point. This is a targeted patch for a
  handful of known locations, not a general grade-separation model — consistent
  with VISION.md's "no elevation" non-goal.
- **Still repair-by-tolerance on the existing bundled data.** No change to
  `porto-streets.json`, its schema, or its extraction pipeline.

## Repository layout after this phase

```text
src/
├── graph.ts                    # + the crossing/corridor repair pass
├── graph.test.ts                # extended
```

Nothing else changes: `StreetGraph`'s public shape, `app/trace.ts`,
`app/map.ts`, `match/loopSearch.ts` and every other caller are untouched —
this phase only makes the graph `buildStreetGraph` already produces more
connected.

## New / changed code

### `graph.ts` (pure)

```ts
/** Corridor half-width used by the crossing/proximity repair pass, metres. */
export const CORRIDOR_M = 6

/** Known grade-separated crossings in the bundled bbox (bridges, viaducts)
 *  where a 2D crossing test would wrongly merge two roads that do not
 *  actually meet. Porto-frame metres (`portoProjection`, the same frame
 *  `Street` points already arrive in) so this stays a plain-data constant
 *  with no new runtime projection step; populated during implementation
 *  from a spot-check of the built graph. */
const GRADE_SEPARATED_EXCLUSIONS: readonly Point[] = [
  /* 8 points found by the real-data spot-check — see the ROADMAP decision
   * log entry for the named locations (the Douro bridges, several viaducts,
   * the Circunvalação's grade separation) */
]
const EXCLUDE_RADIUS_M = 25
```

`buildGraphCore` gains a third pass after the existing two, using the same
`Street`/`Point` inputs and the existing `UnionFind`/`buildSegmentGrid`
helpers:

1. Build (or reuse) the segment grid over all ways' segments.
2. For each segment, query nearby segments (from other ways, not already
   unioned) within `CORRIDOR_M` of its bounding box.
3. Compute true segment-to-segment distance; if `<= CORRIDOR_M`, compute the
   closest-approach point, skip it if within `EXCLUDE_RADIUS_M` of a
   `GRADE_SEPARATED_EXCLUSIONS` entry (projected to the metric frame), else
   split both ways there (reusing/generalising the existing `Split` handling
   to accept a pair of same-position splits, one per way) and union them.
4. Rebuild edges from the now-three-pass split set, same as today.

`componentLengthsM` needs no signature change — it already measures whatever
`buildGraphCore` produces.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `CORRIDOR_M` | `6` | two segments closer than this (or crossing) are treated as meeting |
| `EXCLUDE_RADIUS_M` | `25` | a crossing point this close to a listed grade-separated location is not merged |

`CORRIDOR_M` was tried up to 40m during implementation and rolled back to the
spec's original conservative value — see the post-implementation note above.
`EXCLUDE_RADIUS_M` moved from the spec's original 15 to 25 to comfortably
cover a cluster of nearby footway/viaduct structures found during the
real-data spot-check (e.g. the Ribeira gorge footway viaducts) with one
exclusion point rather than several.

## Tests

All offline, default vitest environment.

- **`graph` (synthetic)**: two ways that cross mid-segment with no shared
  vertex connect after this pass (Phase 7 alone leaves them disconnected —
  add a regression test asserting the *old* behaviour would have failed);
  two ways running parallel within `CORRIDOR_M` of each other connect; two
  ways farther apart than `CORRIDOR_M` on non-crossing paths stay
  disconnected; a crossing whose point falls within `EXCLUDE_RADIUS_M` of a
  `GRADE_SEPARATED_EXCLUSIONS` entry stays disconnected even though it is
  within `CORRIDOR_M`; `fast-check`: adding this pass never *decreases* the
  largest connected component's share on a random network (monotonic
  improvement — the pass only adds edges, never removes them).
- **`graph` (real data)**: update the existing "materially connected" test's
  floor to reflect the new figure (measured during implementation; expect
  something in the 95–99% range per the investigation above, kept
  comfortably below the measured value so minor future data edits don't make
  it flaky). Report the before/after share in the ROADMAP decision log, same
  convention as Phase 7.
- **`match/loopSearch` (real data)**: extended the existing real-data test to
  loop over all three bundled circuits (not just the first) and log, per
  circuit, how many suggestions routed. Deliberately does **not** assert a
  routed count — see *Acceptance criteria* above for why that number is
  honestly zero at the shipped `CORRIDOR_M` — matching Phase 8's own
  real-data test, which also found (and reported, rather than asserted away)
  an all-zero result.

## Acceptance criteria

Met:

- `npm run test:run` and `npm run build` pass.
- The real-data connectivity test reports a largest-component share
  materially higher than Phase 7's measured 88.3% — **~95.3%**, logged in the
  ROADMAP decision log.
- Spot-checking the built graph against the known Douro bridges and
  viaducts inside the bbox drove `GRADE_SEPARATED_EXCLUSIONS`; at the shipped
  `CORRIDOR_M=6` the residual false-merge exposure from the same spot-check
  is small relative to the ~11k crossings the pass creates.
- No new dependency, no new data file, no change to `porto-streets.json`,
  `SavedPlacement`'s stored shape, or any public type outside `graph.ts`.

**Not met, and left open on purpose:**

- The real-data loop-search test does **not** find any of the three bundled
  circuits returning a routed suggestion at 1:1 scale. Connectivity was the
  hypothesised sole blocker going into this phase; it measurably wasn't —
  Phase 8's `MAX_LENGTH_RATIO` (out of this phase's scope to change) is the
  next one, precisely diagnosed above. `npm run dev`'s **Suggest placements**
  still shows Phase 6 fallback rows only, same as before this phase.

This phase still ships as `done`: the connectivity repair it set out to build
is real, tested, and measurably correct: it just isn't sufficient on its own
to flip the user-visible outcome, and forcing it to look sufficient by
loosening `CORRIDOR_M` was rejected as unsafe (see above). What changed
instead is the precision of the next question, which is exactly what Phase 7
and Phase 8 each did for the phase after them.

## Not in scope

- **Re-fetching or re-simplifying `porto-streets.json`.** This phase repairs
  connectivity purely at graph-build time, same principle as Phase 7.
- **Elevation / grade-separation modelling.** A short hardcoded exclusion
  list for known locations, not a general fix — consistent with VISION.md's
  non-goal.
- **Freeform, shape-first graph search** (bending a loop street-by-street
  instead of validating Phase 6's rigid poses) — still a later item if this
  phase's connectivity fix turns out not to be enough on its own.
- **Extending coverage beyond the bundled Porto bbox.**
- **Tuning Phase 6/8's own search or objective constants** — this phase only
  changes what the graph considers connected; `searchPlacements` and
  `searchRoutedLoops` are untouched.
