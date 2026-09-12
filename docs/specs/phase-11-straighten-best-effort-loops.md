# Spec — Phase 11: Straighten best-effort loops (direction-aware snapping)

Status: `done`
Depends on: [phase-8-routed-loop-suggestions.md](phase-8-routed-loop-suggestions.md),
[phase-10-best-effort-routed-loops.md](phase-10-best-effort-routed-loops.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Real-data testing of Phase 10 (see the 2026-09-12 decision-log entry, and a
concrete user-reported example: a 4.67 km circuit whose best-effort suggestion
came back as a 10.02 km loop) shows every best-effort loop running noticeably
longer than the circuit it's built from, with visible "there and back" spurs —
short, unnecessary detours where the drawn route jogs off and returns before
continuing. The shape still tracks the circuit reasonably well (deviation
stays modest), so this is not a data-coverage problem; it is a construction
problem.

`tryRouteLoop` and `buildBestEffortLoop` resample the placed circuit outline
at `LOOP_SAMPLES` even points and snap each one, **independently**, to the
nearest street point within `LOOP_SNAP_MAX_M` (`graph.nearestPointM`) — pure
nearest-distance, blind to which way the street runs. A sample can snap onto a
perpendicular side street, a driveway stub, or a bend in a nearby parallel
street — anything physically close, whether or not it continues the circuit's
own direction of travel there. The leg on either side of such a sample has to
detour to reach it and then back out, adding real distance without improving
the shape match. This phase adds that missing constraint: prefer a street that
also runs *the way the circuit does here*, the same test Phase 6's own
candidate scoring already applies (`objective.ts`'s `scoreCandidate`, via
`StreetIndex.nearestAlignedM`) but that loop *construction* never adopted.

This directly targets the "cabelos" (hairs) the user described: short,
visually obvious back-and-forth jogs that inflate length and roughen the drawn
line without changing what the suggestion is fundamentally about. It is
independent of, and can ship before or after,
[phase-12-anchor-on-real-streets.md](phase-12-anchor-on-real-streets.md) —
better *candidate placements* (Phase 12) and straighter *loop construction*
per placement (this phase) are separate levers.

## How it stays true to the vision

- **"Trace the actual running route along real streets, following the
  overlay"** — a route that jogs sideways to touch an unrelated driveway
  before continuing is a worse approximation of "the actual running route"
  than one that stays on the street actually running alongside the circuit
  here, even at the same deviation figure.
- **Judgement stays with the user; no automated match score.** This phase
  changes which street a sample resolves to, not how "good" a suggestion is
  declared — the user still sees plain length/gap/deviation numbers and
  judges for themselves.
- **No elevation, no silent patching.** A sample that has no *aligned* street
  nearby is treated exactly like one with no street at all: an honest gap,
  not a silent fall-back to the nearest-but-wrong-direction point.
- **Static and offline; no new dependency.** Reuses the existing graph index
  and the alignment test already proven in Phase 6.

## Vocabulary

- **Heading** — the circuit's own local direction of travel at a sample,
  computed exactly as `objective.ts`'s `scoreCandidate` already does (the
  chord between the points `HEADING_SPAN` indices ahead and behind, rotated by
  the candidate's `rotationRad`).
- **Aligned point** — a point on the street network whose local edge
  direction is within `alignMaxRad` of a given heading, direction ignored
  (compared modulo π, matching `StreetIndex.nearestAlignedM`).
- Reuses **node**, **edge**, **graph**, **real leg**, **gap leg**, **best-effort
  loop** (Phase 7/10) unchanged.

## Decisions locked for this phase

- **New `StreetGraph` method: `nearestAlignedPointM`.** Mirrors
  `nearestPointM` — same expanding-radius search, same return shape — but
  candidate edge segments are filtered by heading alignment before distance
  is considered, using the same "modulo π, compare `|cos|` against a
  tolerance" test `StreetIndex.nearestAlignedM` already implements. No change
  to `nearestPointM` or `nearestNode` themselves — both keep their current,
  direction-blind behaviour for their existing callers (manual tracing,
  Phase 6 candidate resolution elsewhere).
- **`tryRouteLoop` and `buildBestEffortLoop` snap via `nearestAlignedPointM`,
  not `nearestPointM`.** Each of the `samples` points gets its own heading
  (same local-tangent computation as `scoreCandidate`, factored out so it
  isn't duplicated a third time) and resolves via the aligned search. Default
  tolerance reuses `objective.ts`'s existing `ALIGN_MAX_RAD` — no new
  constant — exposed as an optional `alignMaxRad` param on both functions,
  matching how `samples`/`snapMaxM` are already optional.
- **No aligned street within `snapMaxM` means unresolved, full stop.** This
  phase does **not** fall back to the plain nearest point when nothing aligned
  is close enough — that fallback would silently reintroduce the exact
  wrong-direction snap this phase removes. For `buildBestEffortLoop` (never
  fails), an unresolved sample becomes a gap, exactly as "no street within
  tolerance at all" already does today. For `tryRouteLoop` (all-or-nothing),
  it fails the candidate, exactly as today. This may raise reported gap counts
  on some candidates — an honest trade described in Acceptance below, not a
  regression: a spurious "real" leg that silently went the wrong way is worse
  than an honestly marked gap.
- **`MAX_LENGTH_RATIO`, `LOOP_SAMPLES`, `LOOP_SNAP_MAX_M`, `CORRIDOR_M`
  unchanged.** This phase only changes *which* point a sample resolves to,
  not the sampling density, snap radius, or any other existing tuning.

## Repository layout after this phase

```text
src/
├── graph.ts                      # + nearestAlignedPointM
├── graph.test.ts                  # extended
├── match/
│   ├── objective.ts               # local-heading helper factored out, reused
│   ├── loopSearch.ts              # tryRouteLoop / buildBestEffortLoop snap via nearestAlignedPointM
│   └── loopSearch.test.ts         # extended
```

`app/trace.ts`, `app/map.ts`, `ui/controls.ts`, `search.ts`, `streets.ts`,
`state.ts` unchanged — manual tracing keeps its existing (direction-blind)
resolution; this phase only touches suggestion construction.

## New / changed code

### `graph.ts`

```ts
export type StreetGraph = {
  // ...unchanged members...
  /**
   * Like `nearestPointM`, but only edge segments whose local direction is
   * within `maxAngleRad` of `heading` (mod π — direction of travel doesn't
   * matter) are considered. "Is there a street here I could run *along*?",
   * not merely "is a street nearby?". Mirrors `StreetIndex.nearestAlignedM`.
   */
  nearestAlignedPointM(
    p: Point,
    heading: Point,
    maxM: number,
    maxAngleRad: number,
  ): { node: NodeId; point: Point; distanceM: number } | null
}
```

Implementation reuses the existing `expandingSearch` helper and
`edgeSegGrid`, adding the same `|cos| >= minAbsCos` filter
`StreetIndex.nearestAlignedM` already uses, applied to each candidate segment
before `projectOntoSegment`/distance is computed.

### `match/objective.ts`

```ts
/** The circuit's own local direction of travel at ring index `i`, placed at
 *  `rotationRad` — the chord between the points `HEADING_SPAN` indices ahead
 *  and behind. Factored out of `scoreCandidate` so loop construction
 *  (Phase 11) can compute the same heading a sample was scored with. */
export function localHeading(ring: readonly Point[], i: number, rotationRad: number): Point
```

### `match/loopSearch.ts`

`tryRouteLoop` and `buildBestEffortLoop` both change their per-sample
resolution step from:

```ts
const resolved = graph.nearestPointM(p, snapMaxM)
```

to:

```ts
const heading = localHeading(ring, idx[s]!, candidate.rotationRad)
const resolved = graph.nearestAlignedPointM(p, heading, snapMaxM, alignMaxRad)
```

Both functions gain an optional `alignMaxRad` (default `ALIGN_MAX_RAD`,
imported from `objective.ts`) alongside their existing `samples`/`snapMaxM`
options.

## Constants

No new tunable constants: reuses `objective.ts`'s existing `ALIGN_MAX_RAD` /
`ALIGN_MAX_DEG` as the default alignment tolerance for loop construction too.

## Tests

- **`graph.test.ts` `nearestAlignedPointM`**: a right-angle junction (a long
  through-street plus a short perpendicular side street) — a point near the
  junction resolves to the through-street when given a heading aligned with
  it, and to `null` (not the side street) when nothing aligned is within
  range even though the side street is physically closer; a zero-length
  heading is rejected by the type (unlike `StreetIndex.nearestAlignedM`,
  which falls back to plain-nearest for a zero heading — this method always
  requires a real heading, since both its callers always have one).
- **`loopSearch.test.ts` `tryRouteLoop` / `buildBestEffortLoop`**: a fixture
  with a through-street plus a perpendicular stub positioned so a naive
  nearest-point snap would pick the stub (closer in raw distance) — confirm
  the sample now resolves onto the through-street instead, and the resulting
  leg has no there-and-back detour; a fixture where *no* aligned street is
  within `snapMaxM` (only a misaligned one) confirms the sample is treated as
  unresolved (a gap for `buildBestEffortLoop`, a rejection for `tryRouteLoop`)
  rather than silently snapping to the misaligned street.
- **Real data**: extend Phase 10's real-data `searchRoutedLoops` test to log,
  per bundled circuit, best-effort `lengthM`/`gapCount`/`gapLengthM` again,
  for a direct before/after comparison against the numbers already in the
  2026-09-12 decision-log entry (lengths currently 2.1–3.6× the circuit's own
  length on the bundled circuits). Expect shorter `lengthM` and fewer legs
  overall, logged in the ROADMAP decision log alongside the actual numbers —
  `gapCount`/`gapLengthM` may rise on some candidates (see the "unresolved
  means unresolved" decision above) and that is an acceptable, expected
  trade, not a regression.

## Acceptance criteria

- `npm run test:run` and `npm run build` pass.
- The real-data test reports, per bundled circuit, best-effort `lengthM`
  materially closer to the circuit's own length than Phase 10's logged
  numbers (concretely: down from the 2.1–3.6× range), with the actual
  before/after numbers recorded in the ROADMAP decision log.
- `npm run dev`: **Suggest placements** best-effort rows on the bundled
  circuits visibly show fewer "there and back" jogs when previewed/applied —
  a visual judgement call, confirmed by the user per VISION's "judgement
  stays with the user" principle, not an automated shape metric.
- No change to `MAX_LENGTH_RATIO`, `LOOP_SAMPLES`, `LOOP_SNAP_MAX_M`,
  `CORRIDOR_M`, `SavedPlacement`'s stored shape, or manual **Trace route**
  behaviour (unrelated to suggestion construction).

## Not in scope

- **Parallel-street ping-pong**: two aligned, roughly-parallel streets a short
  distance apart (e.g. a divided road, or a through-street with a service
  road alongside) could still cause consecutive samples to alternate between
  them. The alignment fix targets the *perpendicular* wrong-direction case,
  which is expected to be the dominant one on Porto's data; revisit only if
  real-data testing after this phase still shows visible zigzag of this kind.
- **Candidate placement / geographic diversity** — that is
  [phase-12-anchor-on-real-streets.md](phase-12-anchor-on-real-streets.md), a
  separate lever (where to place the circuit, not how to fit the loop once
  placed).
- **Merging artificially-split OSM ways** for a better sense of "the street
  running through here" — this phase reasons about local edge direction only,
  segment by segment; it does not need way-level merging to work.
- **Changing `searchRoutedLoops`'s ranking** (still `gapLengthM` then
  `meanDeviationM`) or `searchPlacements`/Phase 6 candidate generation.
