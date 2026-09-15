# Spec — Phase 20: Detect and expose backtracking in skeleton loops

Status: `done`
Depends on: [phase-14-corner-anchored-placement.md](phase-14-corner-anchored-placement.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

A direct user report, verified with real data before writing anything: a
Phase 14 skeleton's honest-looking numbers ("10 corners · 6.15 km · 0 gaps")
can hide a **comb pattern** — go up a street toward a landmark, come back
down the same street to reach a connector, go up the parallel street to the
next landmark, come back again — real, connected, gap-free street segments
that are mostly *retracing the same ground twice* rather than tracing new
distance around the circuit's own shape. The user's own description: given
enough closely-spaced parallel streets that never touch, a circuit's finish
straight placed perpendicular across them would score near-total coverage
sample by sample, "só que não conseguia correr" — coverage (and, this phase
found, skeleton construction) never asks whether consecutive matches are
*reachable from each other without doubling back*, only whether each one
individually sits near a well-aligned street.

**Measured, not assumed**: for the three bundled circuits' own top-ranked
placement, built into a skeleton the normal way and checked leg-by-leg via
the graph's own `shortestPath.edgeIds` (already computed, currently
discarded):

| Circuit | Corners | Overlapping leg pairs | Worst single overlap |
| --- | --- | --- | --- |
| hungaroring | 10 | **10 of 10** possible adjacent pairs | 23 shared edges (legs 6↔7) |
| silverstone | 8 | 3 | 6 shared edges |
| catalunya | 9 | 5, including two *non-adjacent* legs (2↔6, 36 shared edges) | 36 shared edges |

This is not a rare edge case — for hungaroring, **every single leg boundary**
involves some retraced street. The mechanism is exactly Phase 11's old
problem (a sample resolving somewhere that forces "a there-and-back"),
recurring at the landmark level because `resolveLandmark` picks each
landmark's best-aligned real street **independently**, with no awareness of
what street its neighbours already resolved onto — precisely what Phase 8's
`RoutedLoop.simple` flag used to catch (declared, tested, and ranked on) for
the old rigid-pose loops, and what Phase 14 never re-added when it replaced
that mechanism.

This phase fixes the **visibility** gap, not yet the underlying cause (see
[phase-21](phase-21-avoid-skeleton-backtracking.md) for the harder, not-yet-
validated follow-up): a skeleton's real length should distinguish genuine new
ground from retraced ground, and the specific landmark most responsible for
each retrace should be identifiable on the map — restoring the actual
promise of Phase 14's design ("the computer flags the 2-3 points that need
fixing, you drag them"), which today it cannot keep because nothing points
at which corner is the problem.

## How it stays true to the vision

- **"Judgement stays with the user."** The fix is disclosure, not a silent
  algorithmic patch — exactly Phase 8's own `simple: false` precedent
  ("never rejected on its own, only reported"), applied to the mechanism
  that replaced it.
- **Plain metres, no score.** `retracedM` is a length, like every other
  number this app already shows (`gapLengthM`, `meanDeviationM`) — not a new
  composite "quality score."
- **No behaviour change to what a skeleton *is*** — same landmarks, same
  legs, same routing. This phase only computes and surfaces one more honest
  fact about the result already being built.

## Decisions locked for this phase

- **`RouteLeg` (in `app/trace.ts`, shared by manual tracing and Phase 14)
  gains `edgeIds: readonly number[]`** — the graph's `shortestPath` already
  returns this (`graph.ts`'s `shortestPath` result includes `edgeIds`,
  currently used only by the deleted Phase 8 code and by
  `match/landmarks.ts` *not at all*); `joinWaypoints` just needs to stop
  discarding it: `legs.push({ points: legPoints, real: routed !== null,
  edgeIds: routed?.edgeIds ?? [] })`. A gap leg's `edgeIds` is `[]` (no real
  edges walked). Purely additive — nothing today reads `RouteLeg.edgeIds`,
  so manual tracing and its rendering are unaffected.
- **`SkeletonLoop` gains `retracedM: number`**: for every edge id used by
  more than one leg in the loop, every use *beyond the first* counts its
  full length toward `retracedM` — the honest "how many extra metres are
  pure repetition, not new ground" figure. Computed once in `buildLoop`
  (`match/landmarks.ts`) from the now-available `legs[i].edgeIds`, and kept
  current by `moveLandmark` the same way `gapCount`/`lengthM` already are
  (recomputed from the full, current leg list — cheap arithmetic over
  already-known edge ids, no new graph search).
- **Each `LandmarkAnchor` gains a `retraceM: number`** (its own contribution
  to the total): the sum of retraced length across its two adjacent legs —
  the number that decides which marker to colour as "the one to drag."
  Ties or diffuse overlap (catalunya's non-adjacent 2↔6 case) still get a
  real, non-zero number on *some* landmark near each end of the shared
  stretch, even if not a single unambiguous culprit — an honest "these are
  involved" signal beats no signal, even when the fix genuinely needs two
  drags instead of one.
- **UI**: the skeleton summary becomes `"N corners · X.XX km (Y.YY km
  retraced) · N gaps"` — omitting the parenthetical when `retracedM` rounds
  to `0`, so a genuinely clean skeleton's summary stays exactly as short as
  it is today. Landmark markers with `retraceM > 0` render in a third,
  distinct style (alongside today's resolved/gap purple/red) — a concrete
  colour is the implementer's call, but must be visually distinguishable
  from both existing marker states at a glance, since the entire point is
  "which one do I drag."
- **No change to how landmarks are resolved, how legs are routed, or the
  search/placement pipeline upstream of the skeleton.** This phase computes
  and displays a fact about the already-built result; it does not change
  what gets built.

## Repository layout after this phase

```text
src/
├── app/
│   ├── trace.ts        # RouteLeg gains edgeIds; joinWaypoints stops discarding it
│   └── trace.test.ts    # extended
├── match/
│   ├── types.ts         # LandmarkAnchor.retraceM, SkeletonLoop.retracedM
│   ├── landmarks.ts     # buildLoop / moveLandmark compute both
│   └── landmarks.test.ts # extended
├── app/
│   ├── map.ts            # renders the third marker style
│   └── map.test.ts       # extended
└── ui/
    ├── controls.ts        # summary line includes "(Y.YY km retraced)"
    └── controls.test.ts   # extended
```

`graph.ts` unchanged — `edgeIds` already exists on `shortestPath`'s result,
this phase only stops throwing it away one layer up.

## New / changed code

### `src/app/trace.ts`

```ts
export type RouteLeg = { points: Point[]; real: boolean; edgeIds: readonly number[] }

export function joinWaypoints(...): { points: Point[]; legs: RouteLeg[] } {
  // ...
  legs.push({ points: legPoints, real: routed !== null, edgeIds: routed?.edgeIds ?? [] })
  // ...
}
```

### `src/match/types.ts`

```ts
export type LandmarkAnchor = {
  landmark: Landmark
  point: Point | null
  node: NodeId | null
  /** Phase 20: this landmark's own share of the loop's retraced length —
   *  the sum of repeated-edge length across its two adjacent legs. */
  retraceM: number
}

export type SkeletonLoop = {
  anchors: LandmarkAnchor[]
  legs: RouteLeg[]
  lengthM: number
  meanDeviationM: number
  maxDeviationM: number
  gapCount: number
  /** Phase 20: total length counted more than once across the loop's legs —
   *  real, connected street, but retraced rather than new ground. */
  retracedM: number
  placedRingM: Point[]
}
```

### `src/match/landmarks.ts`

```ts
/** For every edge id used by more than one leg, every use beyond the first
 *  counts its length toward the total — the loop's honest "retraced, not new
 *  ground" figure. Also returns each edge's length so callers can attribute
 *  it back to specific legs/landmarks. */
function computeRetraced(legs: readonly RouteLeg[], graph: StreetGraph): {
  totalM: number
  perLegM: number[]  // this leg's own share of retraced length, by index
}

// buildLoop and moveLandmark both call this after assembling `legs`, set
// SkeletonLoop.retracedM from the total, and set each anchor's `retraceM` as
// (perLegM[legBefore] + perLegM[legAfter]) / 2 — split evenly between the two
// landmarks bounding a retraced leg, since a shared edge's "blame" genuinely
// belongs to both ends of that leg, not one arbitrarily.
```

(`computeRetraced` needs each edge's length, not just its id — `graph.ts`
doesn't currently expose per-edge length by id outside the module; the
simplest addition is deriving it from the leg's own `points` when an edge is
first seen, since a leg's `points` already trace its edges in order — no new
`StreetGraph` API required. Implementer's call on the cleanest way to get
there; the contract is the formula above, not the exact plumbing.)

### `src/ui/controls.ts`

```ts
const { cornerCount, lengthM, retracedM, gapCount } = skeleton.stats
const retraceLabel = retracedM > 0.5 ? ` (${formatDistance(retracedM)} retraced)` : ''
// "N corners · X.XX km (Y.YY km retraced) · N gaps"
```

### `src/app/map.ts`

Landmark marker rendering gains a third case: `anchor.retraceM > 0` → a
distinct style, alongside the existing `resolved`/`gap` (`skeleton-marker` /
`skeleton-marker--gap`) classes — e.g. `skeleton-marker--retrace`.

## Constants

None — this phase computes and displays an exact figure, no threshold or
tuning knob.

## Tests

- **`app/trace.test.ts`**: `joinWaypoints`'s real legs carry the exact
  `edgeIds` `shortestPath` returned for that pair; gap legs carry `[]`.
- **`match/landmarks.test.ts`**:
  - A synthetic network where two landmarks' legs are forced to share a
    street (a narrow corridor both must pass through) → `retracedM > 0`,
    matching the known shared length exactly; a fully non-overlapping
    synthetic loop → `retracedM === 0`.
  - `moveLandmark`: dragging the landmark responsible for an overlap onto a
    street that removes the shared edges drops `retracedM` accordingly
    (the concrete "does dragging the flagged marker actually fix it" case —
    this is the test that proves the visibility feature closes the loop back
    to something actionable, not just a number).
  - Real data: re-run the same measurement this spec's investigation did
    (hungaroring/silverstone/catalunya's top candidate) and assert
    `retracedM > 0` for at least hungaroring (the confirmed worst case) —
    a regression guard that this phase's own headline finding stays
    detected, not a claim about the *value* being fixed (that's
    [phase-21](phase-21-avoid-skeleton-backtracking.md)).
- **`ui/controls.test.ts`**: summary includes the retraced clause when
  `retracedM` is non-trivial, omits it when `~0`.

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run dev`: building a skeleton for a circuit with real backtracking
  (Hungaroring's top suggestion reproduces this reliably per the
  investigation above) shows the retraced figure in the summary and at
  least one visually distinct marker; dragging that marker to a different
  real street measurably drops `retracedM` in the updated summary.
- A skeleton with no backtracking (if one is found among the bundled
  circuits' candidates, or constructed for a test) shows no retraced
  clause and no distinctly-styled markers — the feature is silent when
  there is nothing to report.
- `docs/ROADMAP.md` updated per the working method, including the real
  `retracedM` figures for all three bundled circuits' top candidates.

## Not in scope

- **Preventing backtracking** — this phase only detects and displays it;
  [phase-21](phase-21-avoid-skeleton-backtracking.md) covers whether and how
  to avoid it automatically, and needs its own validation before being
  spec'd with confidence.
- **Changing `resolveLandmark`'s search** or any Phase 6/12/15 upstream
  constant — the skeleton this phase measures is built exactly as Phase 14
  already builds it.
- **A numeric "quality score"** combining `retracedM` with `gapCount`/
  `lengthM` into one ranking figure — VISION's "no automated match score"
  principle applies here the same as everywhere else; report the plain
  metres, let the user judge.
