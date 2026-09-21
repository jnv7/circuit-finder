# Spec — Phase 19: Circuit-extraction tooling (the enabler for the full F1 calendar)

Status: `superseded` by [phase-24-find-route-by-name.md](phase-24-find-route-by-name.md) (2026-09-21) — never implemented; kept for its reasoning.
Depends on: [phase-1-geometry.md](phase-1-geometry.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md), [../../src/data/circuits.schema.md](../../src/data/circuits.schema.md)

> **This is a deliberate departure from this project's established
> precedent.** `circuits.schema.md` and `porto-streets.schema.md` both
> record their extraction pipeline as "one-off, not kept in the repo" — a
> reasonable choice when it was run three times total (twice successfully,
> once abandoned for Monaco). The explicit product direction now is the
> full current F1 season calendar, on the order of twenty-plus circuits, run
> through the same fiddly stitch-and-simplify pipeline repeatedly, each one
> needing the same care that caught Monaco's problem in the first place.
> At that scale, a manual one-off stops paying for itself and a committed,
> reusable tool starts to — this phase builds that tool, not a design
> preference for tooling over manual work in general.

## Goal

Turn `circuits.schema.md`'s documented-but-uncommitted pipeline — "fetch the
circuit relation's member ways with geometry, drop pit-lane ways, stitch the
remaining ways into a single ordered ring, project to local metres, simplify
with Douglas–Peucker at a 2.5 m tolerance, and store back as `[lon, lat]`
rounded to 6 decimals" — into a real, run-repeatedly tool, so adding the rest
of the F1 calendar is executing a known-good process per circuit instead of
re-deriving it by hand every time.

**What this tool automates, and what it deliberately doesn't**: the
mechanical, error-prone geometry work (stitching, projecting, simplifying,
validating) is exactly what a script should own. **Finding the right OSM
source for a given circuit is not** — it stays human judgement, the same way
it already was for the three existing circuits (a relation id, chosen and
sanity-checked by eye) and the same way Monaco's evaluation-and-rejection
already showed it has to be: some circuits' OSM data is clean, some (mixed
`highway=raceway`/ordinary-street tagging, split carriageways, no single
clean relation) are not, and no script can currently tell the difference
better than a person looking at the result. The tool's job is to make running
the mechanical half fast and reliable, and to fail loudly and specifically
when a circuit isn't a clean fit — not to paper over that with a guess.

## How it stays true to the vision

- **"Normalised copies of OpenStreetMap geometry... the app never fetches
  OSM at runtime."** Unchanged — this tool runs offline, by hand, before a
  release, exactly like the pipeline it replaces; its output is committed
  static JSON, same as today.
- **Minimal dependencies.** No new runtime dependency for the shipped app —
  the tool is a dev-only script, and its own dependencies (if any beyond
  Node's built-in `fetch`) are `devDependencies`, never bundled.
- **Honest about what it can't do.** A circuit the tool can't cleanly stitch
  is reported as such, specifically, the same way Monaco was documented as
  "evaluated and dropped... remains a roadmap candidate" rather than forced
  through with a bad guess.

## Decisions locked for this phase

- **New `geometry/simplify.ts`: a real, tested Douglas–Peucker
  implementation**, promoted out of the script into the app's own pure
  geometry toolkit — unlike the stitching/Overpass-fetching logic (which is
  genuinely script-only, build-time concerns), polyline simplification is a
  generic geometry primitive on the same footing as `resample`/`recenter`
  already in `geometry/path.ts`, and getting it wrong silently mangles a
  circuit's shape — exactly the kind of risk this codebase's "every
  geometry primitive is pure and tested" pattern exists to catch. The
  extraction script imports it; nothing in the shipped app does (it's dead
  code from the bundler's point of view unless something else calls it —
  acceptable for a small, tested, genuinely reusable primitive, the same
  status `geometry/nearest.ts`'s less commonly used exports already have).
  ```ts
  /** Douglas–Peucker simplification: keep the fewest points whose polyline
   *  stays within toleranceM of the original everywhere. Endpoints (and,
   *  for a closed path, all of them — the ring seam) are always kept. */
  export function simplify(path: Path, toleranceM: number, closed?: boolean): Point[]
  ```
- **New `scripts/extract-circuit.ts`, run manually via `node`** (Node 24's
  built-in TypeScript support — no new build step, no `ts-node`/`tsx`
  dependency needed unless implementation finds a real gap). Not part of
  `npm run build`/`test`/`dev` — a dev-only tool, invoked by hand:
  ```sh
  node scripts/extract-circuit.ts \
    --relation 284557 \
    --id hungaroring --name "Hungaroring" \
    --official-length-m 4381 \
    --lat 47.5789 --lon 19.2486
  ```
  Prints the resulting centreline's point count, projected length, and its
  ratio to `--official-length-m`, and either appends a new entry to
  `src/data/circuits.json` (validated against `validateCircuits` before
  writing — a bad extraction fails loudly, nothing bad ever lands in the
  committed file) or exits non-zero with a specific reason (couldn't stitch
  a closed ring, length ratio outside tolerance, etc.) — never a silent
  partial write.
- **Way-stitching is greedy nearest-endpoint matching with an explicit
  failure mode, not a guess.** Given the relation's member ways (geometry
  already returned by Overpass's `out geom;`), repeatedly attach the way
  whose endpoint is closest to the current chain's open end, within a small
  tolerance (reuses the same "endpoints within N metres are the same point"
  reasoning `graph.ts`'s `NODE_MERGE_M` already established for a different
  purpose — not the same code, since this runs offline against a relation's
  raw ways, but the same idea). If no remaining way's endpoint is within
  tolerance, or the final chain doesn't close within tolerance, the tool
  **stops and reports exactly why** (which way, which gap, how far) instead
  of forcing a stitch — this is precisely the failure mode Monaco hit, and
  the tool should name it specifically enough that the person running it can
  decide "manually drop this extra way" or "this circuit needs a different
  approach", the same judgement call already made for Monaco, just informed
  by a specific diagnostic instead of manual inspection from scratch.
  **Pit-lane ways are excluded by an explicit, inspectable allow/deny list
  the operator edits per relation** (e.g. a `--exclude-ways` flag listing
  OSM way ids), not an automatic heuristic — OSM tagging for "this is the
  pit lane, not the lap" is not consistent enough across circuits to guess
  reliably, and a wrong automatic guess is worse than requiring one manual
  look at the relation's members first.
- **Reuses existing app code for everything downstream of stitching**:
  `src/geo.ts`'s `projectRing`/`localProjection` for the metric projection,
  the new `geometry/simplify.ts` for Douglas–Peucker, and
  `src/circuits.ts`'s own `validateCircuits` to check the assembled entry
  before it's written — the script does not reimplement or duplicate any of
  this, it calls the same pure functions the app itself uses, so "the
  script's output passes validation" and "the app accepts this data" are
  structurally the same claim, not two implementations that could drift.
- **Validated against the three existing circuits before trusting it on new
  ones.** Re-running the tool against Hungaroring/Silverstone/Catalunya's
  same OSM sources (relations/ways already recorded in `circuits.schema.md`)
  should reproduce point counts and projected lengths close to today's
  committed values (exact byte-for-byte match not required — Douglas-Peucker
  and rounding are the same algorithm but a from-scratch reimplementation may
  differ by a point or two — but the *length* should land within a metre or
  two of today's `4356`/`5869`/`4667`, and the point counts should be in the
  same ballpark as today's `70`/`82`/`75`). This is the tool's own regression
  test against known-good ground truth, run once during implementation and
  reported in the ROADMAP decision log, not asserted in `vitest` (it needs a
  live Overpass call, which the default test suite must stay offline
  without — see *Tests*).
- **Ships proven on real, new data**: after the reproduction check above,
  use the tool to successfully add **at least one genuinely new circuit**
  (a permanent-circuit case expected to be straightforward — e.g. Suzuka,
  Monza, or Spa; the specific choice is the implementer's, picked for being
  well-mapped in OSM, not cherry-picked for being easy) as proof the tool
  works end-to-end, not just in theory. Re-attempting Monaco with the new
  diagnostics is explicitly encouraged but not required for this phase to
  ship — if it still fails, report *why* specifically (the tool's improved
  failure message is itself a deliverable, even without a Monaco entry to
  show for it).

## Repository layout after this phase

```text
src/
├── geometry/
│   ├── simplify.ts       # new: Douglas–Peucker (pure)
│   └── simplify.test.ts  # new
└── data/
    └── circuits.json      # + at least one new circuit (proof of the tool working)
scripts/
└── extract-circuit.ts     # new, dev-only, not part of the build
```

No change to `circuits.ts`, `circuits.schema.md`'s *format* (only its
*provenance table*, which gains new rows the same way it already documents
each circuit's source), or any other application file.

## New / changed code

### `src/geometry/simplify.ts` (new, pure)

```ts
import type { Path, Point } from './types'
import { distanceToSegment } from './nearest'

/**
 * Douglas–Peucker simplification: the fewest points from `path` such that
 * every dropped point stays within `toleranceM` of the simplified polyline.
 * For `closed` paths (the ring's own seam included), the two farthest-apart
 * points are used as the initial split instead of the first/last point, so
 * closing doesn't bias which points survive.
 */
export function simplify(path: Path, toleranceM: number, closed = true): Point[]
```

(Standard recursive Douglas–Peucker over the open case, reusing
`geometry/nearest.ts`'s existing `distanceToSegment`; the closed-ring variant
picks its two initial anchor points by farthest pairwise distance before
running the same recursive split — a well-known, small extension, not a
novel algorithm.)

### `scripts/extract-circuit.ts` (new, dev-only)

Pipeline, each stage failing loudly and specifically on its own problem:

1. Parse CLI args (`--relation`/`--way`, `--id`, `--name`,
   `--official-length-m`, `--lat`, `--lon`, `--exclude-ways`).
2. Query Overpass (`out geom;` over the relation/way) via `fetch`.
3. Filter out `--exclude-ways`, then greedy-stitch the remaining ways into
   one ordered ring (see *Decisions locked* above for the exact algorithm
   and failure mode).
4. `projectRing` (from `src/geo.ts`) to local metres.
5. `simplify(..., 2.5, true)` (from the new `geometry/simplify.ts`).
6. Round back to `[lon, lat]` at 6 decimals (inverse of the projection).
7. Assemble a `Circuit` object and run it through `validateCircuits` (from
   `src/circuits.ts`) alongside the existing bundled list — any failure
   (length ratio outside ±20 %, too few points, etc.) aborts with that exact
   message, nothing is written.
8. On success, append to `src/data/circuits.json` and print a
   `circuits.schema.md`-ready provenance-table row for the operator to paste
   in by hand (keeping the schema doc's own accuracy a deliberate human step,
   not auto-generated prose).

## Constants

| name | value | meaning |
| --- | --- | --- |
| Douglas–Peucker tolerance | `2.5` m | matches `circuits.schema.md`'s documented existing pipeline exactly — not re-derived |
| way-endpoint stitch tolerance | starting point `5` m | tuned during implementation against the three known-good circuits; report the real value used in the ROADMAP decision log |

## Tests

- **`geometry/simplify.test.ts`** (offline, default suite):
  - A straight line's interior points are all dropped regardless of
    tolerance (collinear points contribute nothing).
  - A single sharp spike well outside `toleranceM` of the straight line
    connecting its neighbours is kept; a shallow wiggle inside tolerance is
    dropped.
  - Endpoints (open path) / every seam point (closed path) are never
    dropped.
  - `fast-check`: the simplified path's every original point lies within
    `toleranceM` of the simplified polyline (the actual DP guarantee,
    checked directly, not just "fewer points came out").
  - A tolerance of `0` returns the path unchanged (up to point-for-point
    identity) — the degenerate case a from-scratch implementation is most
    likely to get subtly wrong.
- **`scripts/extract-circuit.ts` is not covered by `vitest`** — it makes a
  live Overpass network call by design, and CONVENTIONS.md requires the
  default suite to stay offline. Its correctness is demonstrated by the
  reproduction check (three known circuits) and the new-circuit proof (at
  least one genuinely new addition), both run manually and reported in the
  ROADMAP decision log, the same way this project already treats its data
  pipelines' correctness as a documented one-time verification rather than
  an automated test.

## Acceptance criteria

- `npm run build` and `npm run test:run` pass (only `geometry/simplify.ts`
  and its tests are new to the automated suite).
- Running `scripts/extract-circuit.ts` against Hungaroring/Silverstone/
  Catalunya's existing OSM sources reproduces each one's length within a
  metre or two of today's committed value.
- At least one genuinely new circuit is added to `circuits.json` via the
  tool, passes `npm run build`'s existing circuit-loading validation, and
  renders correctly in `npm run dev` (a recognisable, correctly-scaled
  overlay — visually spot-checked, the same way every prior phase's real-
  data claims were confirmed against the running app, not just a passing
  test).
- `src/data/circuits.schema.md`'s provenance table gains a row for the new
  circuit(s), and its "Pipeline" section is updated to point at
  `scripts/extract-circuit.ts` instead of describing an uncommitted, one-off
  process.
- `docs/ROADMAP.md` updated per the working method, including the
  reproduction-check numbers.

## Not in scope

- **Adding the rest of the F1 calendar.** This phase proves the tool works;
  running it ~20 more times (plus the per-circuit research each run still
  needs) is the next, separately-scoped roadmap item — see
  [ROADMAP.md](../ROADMAP.md)'s classified future list.
- **Automatically identifying pit-lane ways or resolving messy tagging
  (Monaco-style split carriageways).** Both stay explicit, operator-driven
  decisions per *Decisions locked* above — the tool's job is to make the
  clean cases fast and the messy cases diagnosable, not to guess through
  ambiguity.
- **Fetching or updating `porto-streets.json`.** A different pipeline (a
  bounding-box area query, not a per-relation one), untouched by this phase;
  revisit only if/when "street network beyond Porto" (the existing *Later*
  item) is picked up.
- **Any runtime (in-browser) use of Overpass or this script.** Strictly a
  local, offline, pre-release tool — VISION's "no backend, no runtime OSM
  fetch" is unaffected.
