# Spec — Phase 22: Route generator (offline, one circuit at a time, results stored)

Status: `done` — see the 2026-09-21 ROADMAP decision log entry for the
real-data result and two deliberate, spec-permitted departures from the exact
plumbing described below (a whole-recompute `pruneSpikes` instead of an
incremental one, and `escalate.ts`'s own `PRUNE_POOL` constant).
Depends on: [phase-7-street-graph.md](phase-7-street-graph.md),
[phase-5-trace-and-study.md](phase-5-trace-and-study.md) (`routeDeviation`),
[phase-9-graph-connectivity-repair.md](phase-9-graph-connectivity-repair.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

> **Provenance.** Everything below except the storage format was prototyped
> and measured on 2026-09-20 in throwaway code that was deleted (the
> Phase 21 precedent: prototype, measure, record, do not merge the
> prototype). The measurements, the parameters that produced them and their
> caveats are in the ROADMAP decision log entry of that date. This spec
> turns the prototype's *pipeline* into tested, committed modules and adds
> what the prototype never had: a stored output format.

## Goal

Produce, for each bundled circuit, one or a few **closed running routes made
only of real streets that look like the circuit** — and keep them. The
generation is expensive and needs no user input, so it runs **offline, by
hand, once per circuit** (`npm run generate-route -- hungaroring`), and its
result is committed as static data that a page can simply look up (Phase 23).
Nothing is computed in the browser.

"Looks like the circuit" is judged by the metric the user proposed
(2026-09-20): the **symmetric distance between the route and the circuit**
(every route point to the circuit, every circuit point to the route), not
"the circuit outline lies on streets". The prototype showed the outline
cannot lie on streets in Porto at 1:1 (only 56–69 % of any outline is within
10–12 m of an aligned street, even under exhaustive search), whereas a
route that follows the outline loosely can be close everywhere.

## How it stays true to the vision

- **"Match the circuit shape... roughly — it does not need to be a perfect
  match."** The route is a silhouette, allowed to deviate tens of metres.
- **Static and free.** No backend, no runtime OSM fetch: the generator is a
  dev-only script, its output is committed JSON, exactly like
  `circuits.json` and `porto-streets.json`.
- **Judgement stays with the user.** A route that misses the acceptance bar
  is stored and shown as such (with how it misses), never hidden and never
  silently relaxed. The bar's numbers are named constants, not a verdict.
- **Real scale by default.** Scale 1.0. A `--scale` option exists and is
  recorded in the output, but the measured result is at 1.0 only (see
  *Not in scope*).

## The pipeline (four stages, all pure and unit-testable)

1. **Candidate poses — `route/raster.ts`, `route/poseSearch.ts`.** Rasterise
   the bundled street network into 12 orientation layers (each a distance
   transform to the nearest street whose heading is within 35° of the
   layer's) and search **every** (anchor, rotation) exhaustively at loose
   tolerance for the ~120 most distinct poses. A coarse stage (50 m anchors,
   15° rotations) only *discards* impossible poses, soundly (the street
   mask is dilated by the coarse stage's own slack, so no pose the fine
   stage would accept is ever discarded — the prototype checked pruned and
   unpruned searches return the identical best pose); it never ranks.
2. **Map matching — `route/mapMatch.ts`.** For one pose, sample the placed
   circuit every 50 m, take up to 8 graph nodes per sample within 90 m
   (restricted to the graph's largest connected component), and run a
   **closed-loop Viterbi** choosing one node per sample. Cost = emission
   `(distance / 70 m)²` + transition weight 3 on the *excess* of the
   shortest-path length between consecutive nodes over the sample spacing
   (a 0.3 weight on the deficit). This is the joint choice Phase 14's
   `resolveLandmark` lacked (each corner picked its street alone) and that
   Phase 21's post-mortem said a fix would need.
3. **Spike pruning — `route/pruneSpikes.ts`.** Greedily drop a waypoint
   when doing so lowers the sum of the acceptance-bar terms; up to three
   passes; never below 6 waypoints. This removes out-and-back excursions
   that the Viterbi cannot see (it only scores consecutive pairs).
4. **Metrics and ranking — `route/metrics.ts`.** Score each route (below),
   rank by the worst criterion as a multiple of its limit (≤ 1.00 means the
   whole bar is met), keep the best few.

## Decisions locked for this phase

- **Metrics** (all measured against the **full** placed centreline, not the
  Phase 14 corner polygon, which flatters the numbers):
  - `meanDeviationM`, `maxDeviationM` — `app/trace.ts`'s existing
    `routeDeviation` (symmetric, 10 m sampling). Reused, not re-implemented.
  - `frechetM` — discrete Fréchet distance at 20 m sampling, ring start
    aligned to the ring point nearest the route's start (respects order, so
    a route that covers the outline by going back and forth does not score
    well).
  - `lengthRatio` — route length / (circuit length × scale).
  - `retracedFraction` — Σ over graph edges walked more than once of
    `(uses − 1) × edgeLength`, divided by route length (Phase 20's idea,
    computed over the whole loop, not per leg).
- **Acceptance bar** (named constants, provisional — the user accepted the
  defaults on 2026-09-20 without validating them): mean ≤ 30 m, max ≤ 100 m,
  length ratio in [0.9, 1.2], retraced ≤ 5 %. `passesBar` is stored per
  route; failing routes are stored too, with their real numbers. **The bar
  itself is never adjusted per circuit** — see the escalation ladder below
  for what *does* respond when a circuit doesn't clear it.
- **Escalation ladder — the generator tries harder, not looser, before it
  gives up on the bar** (2026-09-20, direct user request). The bar stays
  the fixed yardstick that makes "passes" mean the same thing on every
  circuit; what changes across tiers is how *thoroughly* stages 1–3 search,
  never the objective they search for:

  | Tier | `POSE_COUNT` | `MATCH_RADIUS_M` | `MATCH_CANDIDATES` | `PRUNE_PASSES` |
  | --- | --- | --- | --- | --- |
  | 0 (default) | 120 | 90 | 8 | 3 |
  | 1 (wider) | 240 | 120 | 12 | 5 |
  | 2 (widest) | 400 | 150 | 16 | 8 |

  After tier 0 runs and is pruned, check the best route's `passesBar`. If
  it fails, re-run stages 1–3 at tier 1; if that also fails, tier 2. Stop
  at the first tier whose best route passes, or after tier 2 regardless —
  never a fourth tier, so a bad-fit circuit fails fast rather than burning
  arbitrary time. `RouteFile.generator.escalationTier` records which tier
  produced the stored result (0 unless escalation happened), so a reader
  can see a circuit needed more searching, not just whether it passed.
  Still fully deterministic: the ladder is a fixed sequence, not a search
  over parameters, so the same circuit and street data always escalate the
  same way and land on the same tier.
- **`StreetGraph` gains `componentOf(node): number` and a
  `mainComponent: number`** (largest by node count, computed once at build
  time by a flood fill over the existing adjacency). Needed because `A*` in
  `graph.ts` explores an entire component when asked for a path between
  disconnected nodes, and its open list is an array with O(n) `shift()`;
  the prototype spent minutes there before candidates were restricted to
  the main component (matching 12 poses then took 3 s). Improving `A*`
  itself is out of scope.
- **Output: one file per circuit, `src/data/routes/<circuitId>.json`.** Each
  circuit is generated independently and its diff is reviewable on its own;
  Phase 23 loads them lazily (`import.meta.glob`, non-eager) so the main
  bundle does not grow with the calendar.
- **Top three routes per circuit**, spatially distinct (pose anchors at least
  500 m apart), best first. Fewer if fewer distinct ones exist.
- **Deterministic.** Same circuit, same street data, same options → byte-
  identical output (no randomness, stable tie-breaks, sorted iteration).
- **Runner.** Logic lives in `src/route/` (pure, unit-tested). A thin
  `scripts/generate-route.ts` parses arguments, runs the stages with a
  progress line per stage, and writes the file. Running app modules from a
  script needs a runner that resolves the project's extensionless imports
  and JSON imports; plain `node file.ts` does not. Recommended: add
  **`tsx` as a `devDependency`** (dev-only, never bundled). This is the
  "real gap" Phase 19's spec allowed for; if Phase 19 lands first with a
  different runner, use that one. Fallback proven by the prototype: run the
  script as a Vitest harness.
- **Performance requirement.** A single tier's run must generate in **≤ 15
  minutes on the maintainer's machine**; the full escalation ladder (up to
  3 tiers) in **≤ 45 minutes**. The prototype met the per-tier figure for
  stages 1–2 (~1.5 min at tier 0) but not for stage 3 (~40 min per circuit
  for the 10 best routes under heavy machine load) because it recomputed
  the whole route and every metric for each candidate removal. Stage 3
  therefore must **re-evaluate only what a removal changes** (the two
  affected legs and the metrics they touch) — this matters more now that a
  bad-fit circuit may run stage 3 up to three times. If that design is not
  ready, the acceptable fallback is pruning only the 3 best routes per
  tier, which cuts the cost by a third with no change in the top result.
- **Not run by `npm run test:run`.** The generator itself is long. The
  default suite tests the stages on small synthetic inputs and validates the
  *committed* output files (cheap, offline).

## Output format — `src/data/routes/<circuitId>.json`

```ts
type RouteFile = {
  schemaVersion: 1
  circuitId: string            // must exist in circuits.json
  generatedAt: string          // YYYY-MM-DD
  scale: number                // 1 unless --scale was given
  generator: {
    poses: number              // candidate poses searched at the tier used
    escalationTier: number     // 0, 1, or 2 — see the escalation ladder
    bar: { meanM: number; maxM: number; ratioLo: number; ratioHi: number; retrace: number }
  }
  streets: Attribution         // same shape as porto-streets.json's attribution
  routes: {
    rank: number               // 1 = best
    passesBar: boolean
    area?: string              // free text naming where it is, e.g. "Ribeira and Baixa, north bank of the Douro"
    pose: { anchor: [number, number]; rotationRad: number }  // [lon, lat], scale is the file's
    points: [number, number][] // [lon, lat], 6 decimals, closed loop: first point NOT repeated
    metrics: {
      lengthM: number
      lengthRatio: number
      meanDeviationM: number
      maxDeviationM: number
      frechetM: number
      retracedFraction: number
    }
  }[]
}
```

`points` follow the `circuits.json` convention (GeoJSON axis order, open ring
— the first point is not repeated). A consumer that needs a closed polyline
(GPX, drawing) appends the first point. The circuit outline is **not**
stored: it is `circuits.json`'s centreline placed with `pose` and `scale`
(`geo.ts`'s `placePoints`), so the file cannot disagree with the circuit
data. A new `src/data/routes.schema.md` documents the format like the other
data files, and `src/routes.ts` provides `validateRouteFile` (structure,
finite numbers, ≥ 20 points, ranks 1..n, known `circuitId`).

## Repository layout after this phase

```text
scripts/
└── generate-route.ts            # new: thin CLI, dev-only
src/
├── graph.ts                     # + componentOf / mainComponent
├── graph.test.ts                # extended
├── routes.ts                    # new: RouteFile type, validateRouteFile, loaders
├── routes.test.ts               # new: validates every committed file
├── route/
│   ├── raster.ts                # new: orientation-layer distance transforms
│   ├── poseSearch.ts            # new: coarse sound prune + fine search + distinct top-N
│   ├── mapMatch.ts              # new: closed-loop Viterbi over graph nodes
│   ├── pruneSpikes.ts           # new: incremental greedy waypoint removal
│   ├── metrics.ts               # new: Fréchet, retraced fraction, bar, worst-ratio
│   └── *.test.ts                # new, one per module
└── data/
    ├── routes.schema.md         # new
    └── routes/                  # new: one JSON per generated circuit
package.json                     # + "generate-route" script, tsx devDependency
```

## Constants (all named, all in `src/route/`)

| Constant | Value | Where it came from |
| --- | --- | --- |
| `CELL_M` | 5 | raster cell; tolerance is 50–100 m, so ample |
| `ORIENTATION_LAYERS` | 12 | 15° bins; a point looks up the layer of its own local heading |
| `ALIGN_DEG` | 35 | same as `ALIGN_MAX_DEG` used by every earlier phase |
| `CANDIDATE_CAP_M` | 60 | per-sample cost cap in the candidate search |
| `COARSE_ANCHOR_M` / `COARSE_ROT_DEG` | 50 / 15 | coarse stage (discard only) |
| `HOLE_T_M` / `MAX_HOLE_M` | 30 / 200 | a run of samples farther than 30 m from an aligned street longer than 200 m rules a pose out |
| `POSE_COUNT` | 120 | distinct candidate poses handed to map matching |
| `POSE_DEDUP_M` / `POSE_DEDUP_DEG` | 150 / 10 | distinctness of candidate poses |
| `MATCH_STEP_M` / `MATCH_RADIUS_M` | 50 / 90 | sample spacing / candidate search radius |
| `MATCH_CANDIDATES` / `MATCH_MIN_SEP_M` | 8 / 30 | nodes per sample, at least this far apart |
| `EMISSION_SCALE_M` | 70 | emission = (d / 70)² |
| `TRANS_WEIGHT` / `TRANS_CAP` / `TRANS_DEFICIT` | 3 / 10 / 0.3 | transition cost on path-length excess/deficit |
| `MAX_HOP_FACTOR` | 3 | candidate pairs farther than 3× the step are not connected |
| `PRUNE_PASSES` / `MIN_WAYPOINTS` | 3 / 6 | spike pruning limits |
| `BAR` | 30 m / 100 m / 0.9–1.2 / 5 % | acceptance bar (provisional) |
| `ROUTES_KEPT` / `ROUTE_SEPARATION_M` | 3 / 500 | routes stored per circuit |

The parameters were tuned on Hungaroring's 12 candidate poses only (a
12-combination sweep) and applied unchanged to Silverstone and Catalunya;
they held on Catalunya and less well on Silverstone. Retuning per circuit is
allowed **only** if recorded (`generator` block) — a route file must say how
it was made.

## Tests

- **`route/raster.test.ts`**: a synthetic street ring — the distance is 0 on
  the ring in the layer of its own heading, grows with distance, and a
  perpendicular layer sees nothing there; out-of-bounds lookups read as "no
  street".
- **`route/poseSearch.test.ts`**: **planted circuit** — a circuit placed at a
  known pose and drawn as the only street is found at that pose (the
  prototype: within 0.1 m and 0.1°); the coarse prune is **sound** (pruned
  and unpruned searches return the same best pose on a small synthetic map).
- **`route/mapMatch.test.ts`**: on a synthetic street grid with an obvious
  best loop, the Viterbi returns it; candidates outside the main component
  are never used; a pose with a sample farther than the radius from any
  node returns `null` (an honest "cannot", not a guess).
- **`route/pruneSpikes.test.ts`**: a loop with a planted out-and-back spur
  loses exactly the spur; a clean loop is returned unchanged; the result is
  identical to the naive whole-recompute version on random small cases
  (`fast-check`) — this is the guard for the incremental optimisation.
- **`route/metrics.test.ts`**: Fréchet of identical curves is 0, of a shifted
  copy equals the shift, and is order-sensitive (a reversed traversal is not
  small); retraced fraction of a loop that walks one edge twice equals that
  edge's length share; `worstRatio ≤ 1` iff every bar term is met.
- **`graph.test.ts`**: `componentOf` labels two disjoint synthetic networks
  differently and `mainComponent` is the larger; on the real network the main
  component holds at least 90 % of nodes (measured 2026-09-20: 34 474 of
  37 653 nodes, 91.6 %, across 1 313 components; the next largest has 42
  nodes — so the restriction discards only stray footpaths and fragments).
- **`routes.test.ts`**: every file in `src/data/routes/` passes
  `validateRouteFile`; each route's stored `metrics` **recompute to the same
  numbers** from its stored `points` and pose against the circuit and the
  bundled graph (cheap: one metric evaluation per route, no search) — so a
  stale or hand-edited file fails the default suite.
- **`route/escalate.test.ts`**: on a synthetic street layout where tier 0's
  narrower search cannot clear the bar but tier 1's wider one can, the
  ladder stops at tier 1 and reports `escalationTier: 1`; on a layout no
  tier clears, it runs all three tiers (asserted via a call-count spy) and
  returns tier 2's best result with `passesBar: false`; on a layout tier 0
  already clears, tiers 1–2 never run at all (cost guard, not just a
  correctness one).
- Explicitly **not** in the default suite: running the search on real data
  end to end (minutes). It is run by hand and its result recorded.

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run generate-route -- hungaroring` finishes within the performance
  requirement and writes `src/data/routes/hungaroring.json`; the same for
  `silverstone` and `catalunya`.
- The committed results reproduce the prototype's finding to within
  tolerance: for Hungaroring and Catalunya the top route meets the bar (or
  the file honestly records how it misses), and every kept route's mean
  deviation is well under Phase 14's 35–116 m range on the same metric. Any
  material difference from the prototype's numbers (mean 22/22/33 m, max
  76/88/128 m for the best route of hungaroring/catalunya/silverstone) is
  explained in the decision log rather than tuned away.
- Running twice produces identical files.
- `docs/ROADMAP.md` updated per the working method; `RELEASES.md` gains an
  entry only when Phase 23 makes the routes visible to the user.

## Not in scope

- **Anything in the browser.** No in-page generation, no worker, no runtime
  computation. Phase 23 only reads the stored files.
- **Scales other than 1.0 as a measured result.** The 2026-09-20 scale
  experiment (0.75×–1.25×) raised the one-directional fit by 0–8 points
  only; the route-first metric was measured at 1.0. The option exists and is
  recorded; producing and judging other scales is a later, explicit choice.
- **Mirroring** (VISION non-goal), **elevation**, **surface / steps /
  runnability filters.** The street set includes footways, paths and steps;
  a route can use them. Whether a route is *pleasant to run* is judged by the
  person, from the page.
- **Improving `A*`** in `graph.ts` (priority queue, bounded search).
- **Retiring the Phase 6–15 suggestion flow or the Phase 14 skeleton** in the
  main page. They keep working untouched; whether to retire them is a
  separate decision once the routes page has been used.

## Open questions

- Is the provisional bar the right ruler? Silverstone misses it narrowly
  (mean 33 m, max 128 m, length 1.24×) at tier 0 (the only tier the
  prototype ran) — a different bar would change which routes are labelled
  as passing, not which routes exist. The escalation ladder may close this
  gap on its own when implemented; if Silverstone still misses at tier 2,
  that is the honest ceiling for this circuit at this bar, not a bug.
- Should stored routes be simplified (Douglas–Peucker, Phase 19's
  `geometry/simplify.ts`) to shrink the files? Each is a few hundred points;
  decide from real file sizes once three circuits exist.
