# Spec — Phase 14: Corner-anchored, human-adjustable placement

Status: `done` (shipped 2026-09-14 — see the ROADMAP decision log for the
real-data result)
Depends on: [phase-13-honest-suggestions.md](phase-13-honest-suggestions.md),
[phase-7-street-graph.md](phase-7-street-graph.md),
[phase-5-trace-and-study.md](phase-5-trace-and-study.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md),
[../reviews/2026-09-13-suggested-placements-review.md](../reviews/2026-09-13-suggested-placements-review.md)

> **Sequencing.** Do not start this phase until
> [phase-13](phase-13-honest-suggestions.md) has shipped and
> `match/loopSearch.ts` is gone. This is not a merge conflict to work around —
> `match/landmarks.ts` is a **replacement paradigm**, not an extension of the
> rigid-pose search Phases 8-12 built. Concretely: **do not** import from, port
> logic from, or otherwise resurrect `tryRouteLoop` / `buildBestEffortLoop` /
> `searchRoutedLoops` / `RoutedLoop` / `BestEffortLoop` — Phase 13 deletes them
> because the *idea* they implement (place the whole undeformed outline with
> one rigid transform, then validate or patch a loop under it) is the
> documented root cause of the problem this phase exists to fix, not
> infrastructure to build on. The only things this phase carries forward from
> before are `graph.ts` (routing/connectivity), `app/trace.ts`'s
> `joinWaypoints`/`routeDeviation`, and `match/objective.ts`'s `localHeading` —
> all correct, all unrelated to the rigid-pose idea itself. If in doubt about
> whether a piece of old code is safe to reuse, the test is: does it operate
> on *one* pose for the *whole* shape at once? If yes, it's the discarded
> paradigm — don't reuse it, however tempting the shortcut.

## Goal

Phase 13 stopped the app from claiming a runnable loop it couldn't actually
find. It did not replace the thing that made the loop-search worth trying in
the first place: the user still has to turn a candidate placement into a real
route somehow, and "here is a map, here is the circuit outline, trace it by
hand" (plain Phase 5 tracing) leaves the *hard* part — finding a sequence of
real streets that actually closes into a loop resembling the circuit —
entirely on the user. That is a graph-connectivity search, and people are bad
at exactly that kind of search by eye; pushing it onto the user doesn't make
it tractable, it just moves where the failure is felt.

This phase gives the user a **skeleton** to start from and adjust, instead of
either a blank map or a forced rigid loop:

1. Reduce the circuit's outline to its **significant corners** (10-20 points
   for a typical F1 circuit) instead of Phase 8-12's dense, rigid 60-point
   stencil.
2. For each corner, **independently** search nearby real streets for a
   well-aligned point — each corner gets its own search radius, not one
   global rigid transform that has to get all of them right simultaneously.
3. **Route between consecutive corners** with the graph's existing, correct
   A* (`StreetGraph.shortestPath`), and show the result honestly (length,
   deviation, any leg that couldn't connect).
4. Let the user **drag any corner marker** to a different real street point
   nearby — recomputing only the two legs touching it — so a bad automatic
   pick becomes a two-second manual fix instead of a reason to distrust the
   whole result.
5. Once happy, **commit the skeleton's point sequence as the traced route** —
   reusing Phase 4/5's existing save/trace/study machinery unchanged.

The corners-and-legs object this phase builds (`SkeletonLoop`) is a *working
scratchpad*, not a new persisted concept: it exists only while the user is
building a route, and "commit" hands its points to the same `AppState.route`
Phase 5 already defines, persists, and exports.

## How it stays true to the vision

- **"Move and rotate the overlay by hand to find a plausible location, then
  mark the resulting loop on the map."** This phase is the acetate-and-marker
  analogy made literal: the computer proposes where the marker *could* go at
  each turn (corner search), the human decides where it *actually* goes (drag
  to adjust), exactly the balance of effort VISION.md describes.
- **"Judgement stays with the user; no automated match score."** Nothing here
  is applied without the user seeing it first, and every result is labelled
  with plain metres (length, deviation, gap count) — no headline score, same
  as every other phase.
- **"A 2 km straight is a ~2 km straight."** Because each corner is resolved
  independently rather than forcing one rigid transform to fit all of them,
  and because the user actively fixes bad picks, the expected length ratio is
  materially closer to 1× than Phases 8-12's 1.4-2.24× — see *Acceptance
  criteria* for the concrete bar this phase is judged against.
- **Reuses proven infrastructure only.** `StreetGraph.shortestPath` and
  `nearestAlignedPointM` (`graph.ts`), `geometry/turning.ts`'s curvature
  signal, `app/proximity.ts`'s heatmap, and the click-to-snap pattern already
  in `app/map.ts`'s trace mode are all correct today per the 2026-09-13
  review; this phase composes them differently, it does not reimplement any
  of them.

## Vocabulary

- **Corner** — a significant direction change in the circuit's own outline
  (local frame, unscaled, unrotated): an index into the resampled centreline,
  the point there, and the turn angle at that joint. Purely a property of the
  circuit's shape — computed once per circuit, independent of any placement.
- **Landmark** — a `Corner` plus the local heading of the circuit at that
  point (reusing the existing `localHeading` computation from
  `match/objective.ts`), used to align the search the same way Phase 6-12
  already do ("is there a street here I could run *along*?").
- **Landmark anchor** — where a landmark currently resolves to on the real
  Porto street network for a given placement: a Porto-frame point + graph
  node, or `null` if nothing acceptable was found (a gap, same concept as
  `RouteLeg.real === false` already carries for manual tracing).
- **Skeleton loop** — the closed sequence of legs connecting consecutive
  landmark anchors, each leg either a real routed path
  (`StreetGraph.shortestPath`) or a straight gap, in landmark order, with the
  last landmark connecting back to the first to close the loop.

## Decisions locked for this phase

- **Corner extraction is a new pure geometry function**, not a byproduct of
  the existing `longestStraight` — it needs to return *every* significant
  joint, not just the single longest straight run. Two thresholds control it:
  a minimum turn angle (`MIN_TURN_RAD`) below which a joint is noise from
  resampling, not a real corner; and a minimum spacing (`MIN_CORNER_SPACING_M`)
  below which two nearby significant joints are merged into one landmark
  (keeping the sharper of the two) — modelling a chicane or a corner complex
  as one landmark rather than several redundant ones close together. Both are
  tuned against the three bundled circuits during implementation, not derived
  analytically; log the resulting corner count per circuit in the ROADMAP
  decision-log entry the same way every prior phase has logged its real-data
  numbers.
- **Landmark search is independent per corner, with its own bounded radius**
  (`LANDMARK_SEARCH_RADIUS_M`, default starting point `120` — four times
  `LOOP_SNAP_MAX_M`'s old `30`, since there are far fewer points to place and
  each one matters more). This is the core structural difference from Phases
  8-12: no single rigid transform has to make every corner land correctly at
  once. A landmark search reuses `StreetGraph.nearestAlignedPointM` exactly as
  it exists today — same heading-alignment semantics, larger radius, called
  once per landmark instead of once per one of 60 uniform samples.
- **The candidate placement (anchor + rotation + scale) still comes from
  Phase 6/12's existing search**, unchanged — this phase does not replace how
  a *starting* position is chosen, only what happens once one is. Each
  landmark's *expected* position is that placement applied to the landmark's
  circuit-frame point (same `apply(transform, point)` every other phase
  already uses); the independent search then looks for a real anchor near
  that expected position, not exactly on it.
- **Unresolved landmarks and unconnected legs are gaps, reported honestly** —
  reusing `RouteLeg`'s existing `{ points, real }` shape and
  `app/trace.ts`'s `joinWaypoints` logic as-is (it already does exactly "route
  by shortest path if both endpoints resolved and connect, else a straight
  line, flagged"). With 10-20 landmarks instead of 60 samples, a gap is a
  specific, nameable problem ("the corner near X didn't find a good street")
  the user can fix by dragging that one marker, not one of 20 gaps
  indistinguishable from each other.
- **Dragging a landmark snaps to the network the same way a trace-mode click
  already does**: `streetGraph.nearestPointM(metricPoint, SNAP_MAX_M)`
  ([map.ts:634](../../src/app/map.ts), reused, not reimplemented). Alignment
  is not enforced on a manual drag — once the user is placing a point
  themselves, VISION's "judgement stays with the user" applies directly; the
  alignment filter exists to make the *automatic* search prefer sensible
  streets, not to second-guess a deliberate human choice.
- **Only the two legs touching a moved landmark are recomputed** on drop —
  `shortestPath` is cheap enough per call (already proven at 60-samples-×-5-
  candidates scale in Phase 8-12's real-data tests) that recomputing a whole
  skeleton per drag would be wasteful, not that it would be incorrect.
- **The skeleton is transient app-local state, not `AppState`.** It lives
  alongside `previewSuggestion` in `app/map.ts`'s closure — built by an
  explicit action, discarded on circuit change / trace-mode toggle / dismiss,
  never saved directly. **Committing** it (`onCommitSkeleton`, a new handler)
  copies its current point sequence into `state.route` via a new pure
  `state.ts` reducer (`setRoute`, trivial — `{ ...state, route }`), after
  which it behaves exactly like a hand-traced route: editable with existing
  undo/clear, measured with existing `routeStats`, saved/exported with no
  schema change.
- **No change to `SavedPlacement`'s schema, `placements.ts`, or export/import.**
  Everything this phase produces ends up as a plain `AppState.route` by the
  time it could be saved — the persisted shape doesn't need to know a
  skeleton was ever involved.

## Repository layout after this phase

```text
src/
├── geometry/
│   ├── corners.ts               # new: extractCorners (pure)
│   └── corners.test.ts          # new
├── match/
│   ├── landmarks.ts             # new: buildLandmarks, resolveLandmark, buildSkeletonLoop, moveLandmark
│   ├── landmarks.test.ts        # new
│   └── types.ts                 # + Landmark, LandmarkAnchor, SkeletonLoop
├── app/
│   ├── state.ts                 # + setRoute (trivial reducer)
│   ├── state.test.ts            # extended
│   ├── map.ts                   # skeleton build/drag/commit wiring, new layers
│   └── map.test.ts              # extended
└── ui/
    ├── controls.ts               # + skeleton section (build / stats / commit / dismiss)
    └── controls.test.ts          # extended
```

`graph.ts`, `streets.ts`, `app/proximity.ts`, `app/trace.ts`, `match/search.ts`,
`match/straights.ts`, `match/objective.ts`, `placements.ts` unchanged.

## New / changed code

### `src/geometry/corners.ts` (new, pure)

```ts
import type { Path, Point } from './types'

export type Corner = { index: number; point: Point; turnRad: number }

export type ExtractCornersOptions = {
  /** Turn angle below which a joint is resampling noise, not a real corner. Radians. */
  minTurnRad?: number
  /** Corners closer than this are merged, keeping the sharper one. Metres. */
  minSpacingM?: number
}

/**
 * Every significant direction change in a closed path: joints whose turn
 * exceeds `minTurnRad`, with nearby ones merged. Order follows the path;
 * a corner's `turnRad` is the unsigned turn at that joint (same convention as
 * `geometry/straight.ts`'s internal `turn()`).
 */
export function extractCorners(path: Path, opts?: ExtractCornersOptions): Corner[]
```

Implementation note: walks the same consecutive-segment-direction machinery
`geometry/straight.ts`'s `buildSegments`/`turn` already use (closed ring,
wraps across the seam) — this is the natural generalisation of "find the
single longest straight run" to "find every joint that isn't part of *any*
near-straight run", so the two modules should share the segment-building
helper rather than duplicate it (factor `buildSegments`/`turn` out of
`straight.ts` into a small shared internal, or export them — implementer's
call, no behaviour difference either way).

### `src/match/types.ts` additions

```ts
import type { Corner } from '../geometry/corners'
import type { NodeId } from '../graph'
import type { RouteLeg } from '../app/trace'

export type Landmark = { corner: Corner; heading: Point }

export type LandmarkAnchor = {
  landmark: Landmark
  point: Point | null   // Porto-frame metres; null if unresolved
  node: NodeId | null
}

export type SkeletonLoop = {
  anchors: LandmarkAnchor[]   // circuit order
  legs: RouteLeg[]            // anchors[i] -> anchors[(i+1) % n]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  gapCount: number
}
```

### `src/match/landmarks.ts` (new)

```ts
import { extractCorners } from '../geometry/corners'
import { localHeading } from './objective'
import type { Candidate, Landmark, LandmarkAnchor, SkeletonLoop } from './types'
import type { NodeId, StreetGraph } from '../graph'
import { joinWaypoints, routeDeviation } from '../app/trace'
import { pathLength } from '../geometry/path'

export const MIN_TURN_RAD = 0.35        // ~20°, tuned against bundled circuits
export const MIN_CORNER_SPACING_M = 60  // tuned against bundled circuits
export const LANDMARK_SEARCH_RADIUS_M = 120
export const ALIGN_MAX_RAD = /* reuse app/proximity.ts's ALIGN_MAX_RAD */

/** Every significant corner of the circuit's own outline, as landmarks with
 *  their local heading. Pure function of the circuit shape — independent of
 *  any placement. */
export function buildLandmarks(
  circuitSamplesM: readonly Point[],
  rotationRad: number,
  opts?: { minTurnRad?: number; minSpacingM?: number },
): Landmark[]

/** Resolve one landmark for a given placement: its expected position (the
 *  placement transform applied to the landmark's circuit-frame point),
 *  searched against the graph within `searchRadiusM`. */
export function resolveLandmark(
  landmark: Landmark,
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { searchRadiusM?: number; alignMaxRad?: number },
): LandmarkAnchor

/** Resolve every landmark and join them leg by leg (reuses `joinWaypoints`,
 *  the same primitive manual tracing and — formerly — Phase 10 both used). */
export function buildSkeletonLoop(
  landmarks: readonly Landmark[],
  candidate: Candidate,
  scale: number,
  graph: StreetGraph,
  opts?: { searchRadiusM?: number; alignMaxRad?: number },
): SkeletonLoop

/** Replace one anchor's point/node (already resolved by the caller — e.g. a
 *  drag snapped via `graph.nearestPointM`) and recompute only the two legs
 *  touching it plus the loop's totals. */
export function moveLandmark(
  loop: SkeletonLoop,
  index: number,
  point: Point,
  node: NodeId | null,
  graph: StreetGraph,
): SkeletonLoop
```

`buildSkeletonLoop`'s length/deviation stats are computed the same way
`buildBestEffortLoop` used to (now-deleted, Phase 13) — `pathLength` over the
joined points, `routeDeviation` against the placed circuit ring — no new
statistics concept, just applied to a much shorter point sequence.

### `src/app/state.ts`

```ts
/** Replace the traced route wholesale (e.g. committing a Phase 14 skeleton).
 *  Pure. */
export function setRoute(state: AppState, route: readonly LonLat[]): AppState {
  return { ...state, route: route.map((p) => [p[0], p[1]] as LonLat) }
}
```

### `src/app/map.ts`

- New transient state: `let skeleton: SkeletonLoop | null = null` alongside
  the existing `previewSuggestion`.
- New handler `onBuildSkeleton()`: `buildLandmarks` on the current circuit +
  `state.placement.rotationRad`, then `buildSkeletonLoop` against
  `streetGraph` and the current `state.placement`; stores the result in
  `skeleton`, re-renders.
- New draggable-marker layer, one `L.marker` per `skeleton.anchors[i]`
  (reusing the same `L.divIcon` pattern the rotate `handle` already uses,
  [map.ts:171-176](../../src/app/map.ts)) plus two `RouteLeg` polylines (real /
  gap) exactly like `routeLine`/`routeGapLine`, fed from `skeleton.legs`.
- Each marker's `dragend` handler: snap the drop point via
  `streetGraph.nearestPointM(metricPoint, SNAP_MAX_M)` (same call trace mode
  already makes at [map.ts:634](../../src/app/map.ts)); if it resolves, call
  `moveLandmark(skeleton, i, resolved.point, resolved.node, streetGraph)`; if
  nothing is in range, drop the point with `node: null` (an honest new gap,
  same convention as everywhere else) — never silently reject the drag.
- New handler `onCommitSkeleton()`: `state = setRoute(state, skeleton.legs
  .flatMap(l => l.points).map(p => project.toLonLat(p)))` (dedupe consecutive
  duplicate points at leg joins the same way `joinWaypoints` already avoids
  introducing them); `skeleton = null`; re-render — from this point on the
  result is a normal traced route.
- New handler `onDismissSkeleton()`: `skeleton = null`, re-render, no state
  change.
- Building, committing, or dismissing a skeleton all clear any active
  suggestion preview and vice versa (mutually exclusive transient UI, same
  pattern `clearSuggestions()` already enforces against `previewingSaved`).

### `src/ui/controls.ts`

New section, rendered when a placement exists (after the "Suggest placements"
section, before "Route"):

- Idle: a **"Find corner anchors"** button.
- Built: `"N corners · X.XX km · N gaps"` summary (same honest-numbers style
  as everywhere else), a **"Use as route"** button, a **"Dismiss"** button.
  Individual corner markers are map-only (Leaflet), not listed in the panel —
  consistent with the rotate handle also being map-only.

## Constants

| name | starting value | meaning |
| --- | --- | --- |
| `MIN_TURN_RAD` | `0.35` (~20°) | joint turn angle below which it isn't a landmark |
| `MIN_CORNER_SPACING_M` | `60` | merge landmarks closer than this |
| `LANDMARK_SEARCH_RADIUS_M` | `120` | per-landmark independent search radius |

All three are starting points, tuned during implementation against the three
bundled circuits and reported in the ROADMAP decision-log entry, exactly as
every prior phase's constants were.

## Tests

- **`geometry/corners.test.ts`**: a square ring → exactly 4 corners, each
  `turnRad ≈ π/2`; a near-straight-with-noise ring (small resampling wiggle
  under `minTurnRad`) → those joints excluded; two sharp turns closer than
  `minSpacingM` → merged into one, the sharper kept; a circle-like ring with
  no joint exceeding `minTurnRad` → returns `[]` (documented, not a crash);
  `fast-check`: corner count is invariant to a similarity transform applied to
  the whole ring (rotation/scale/translation don't change *which* joints are
  corners).
- **`match/landmarks.test.ts`**:
  - `buildLandmarks` on a real (or realistic synthetic) circuit shape returns
    a plausible count (roughly 10-20 for the bundled circuits' real turn
    profile — assert a range, not an exact number).
  - `resolveLandmark`: a landmark whose expected position sits exactly on a
    well-aligned synthetic street resolves to it; one with only a
    misaligned street nearby returns a gap (`point: null`), mirroring the
    existing `nearestAlignedPointM` contract; one with a well-aligned street
    just outside `searchRadiusM` also returns a gap.
  - `buildSkeletonLoop`: a synthetic network built so every landmark resolves
    and connects → `gapCount: 0`, `lengthM` close to the landmark-to-landmark
    polygon's own perimeter; a network missing one connection → exactly one
    gap leg, the rest real, never throws.
  - `moveLandmark`: recomputes only the two adjacent legs (assert the other
    legs' point arrays are referentially unchanged) and updates
    `lengthM`/`gapCount` correctly; moving a landmark to close a previously-
    unconnected gap turns that leg real.
- **`app/state.test.ts`**: `setRoute` replaces the route (copied, not
  aliased), pure.
- **`ui/controls.test.ts`**: idle renders the build button; built state
  renders the summary line and both actions; `bind` wires them.
- **`app/map.test.ts` (jsdom)**: `onBuildSkeleton` populates marker/leg
  layers from a stubbed `buildSkeletonLoop`; dragging a marker (simulated
  `dragend`) calls `moveLandmark` and updates the rendered legs; **Use as
  route** calls `setRoute` with the skeleton's flattened points and clears
  the skeleton; **Dismiss** clears it without touching `state.route`.
- **Real data**: a new real-data test (same pattern as the deleted
  `loopSearch.test.ts`'s, same generous timeout budget) runs
  `buildLandmarks` + `buildSkeletonLoop` for all three bundled circuits at
  each circuit's own best Phase 6/12 candidate placement and logs, per
  circuit: corner count, `gapCount`, `lengthM` and its ratio to the circuit's
  real length — the same numbers this review's report cited for Phases 10-12,
  so the improvement (or lack of one) is directly comparable. **This is the
  number the acceptance bar below is judged against.**

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run dev`: after choosing/adjusting a placement, **Find corner anchors**
  draws 10-20 draggable markers connected by routed legs (gaps shown red
  dashed, same visual language as manual tracing already uses); dragging one
  marker to a nearby street visibly fixes just that marker's two legs; **Use
  as route** hands the result to the existing route/study/save flow
  unchanged.
- **The real-data test's logged length ratio is the bar**: this phase is
  judged a success if, for at least two of the three bundled circuits, the
  skeleton loop at the best candidate placement — *before any manual
  dragging* — comes in under **1.2×** the circuit's real length with **fewer
  than 4 gaps**, a material improvement over Phases 10-12's 1.43-2.24× /
  10-29 gaps documented in the 2026-09-13 review. If real data doesn't clear
  this bar, ship anyway (the drag-to-adjust interaction is the actual
  point — an imperfect automatic starting skeleton is still far more useful
  than either the deleted best-effort loop or an unaided blank map) but
  record the honest number in the decision log rather than the bar met,
  exactly as Phase 8's decision log honestly reported zero routed
  suggestions instead of adjusting the bar to declare victory.
- `docs/ROADMAP.md` updated: Phase 14 → `done`, dated decision-log entry with
  the real corner counts / gap counts / length ratios per bundled circuit,
  "Current priority" moved on. `RELEASES.md` gets a user-facing entry
  describing the new corner-drag workflow.

## Not in scope

- **Persisting a skeleton independent of committing it to `route`.** If a
  user wants to save work-in-progress corner placement across a session
  reload before committing, that is a later item, not this phase — today's
  behaviour (lost on reload, same as an uncommitted trace today) is
  acceptable for a first cut.
- **Multi-candidate skeleton comparison** (building a skeleton for more than
  one Phase 6/12 candidate at once to compare). One at a time, same as
  today's single active placement.
- **Automatic re-routing of a landmark when a *different* landmark moves.**
  Only the mover's own two legs recompute; a cascading "improve the whole
  loop after one drag" pass is a possible later refinement, not required for
  the core workflow to be useful.
- **Changing `MIN_TURN_RAD`/`MIN_CORNER_SPACING_M`/`LANDMARK_SEARCH_RADIUS_M`
  from the UI.** Search options like any other phase's constants, not
  user-facing here.
- **Reusing any part of the deleted `match/loopSearch.ts`.** Phase 13 deleted
  it outright; this phase's `match/landmarks.ts` is a new module built on
  `graph.ts` directly, not a revival of the rigid-loop code.
