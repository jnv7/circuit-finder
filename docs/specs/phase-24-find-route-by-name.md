# Spec — Phase 24: `find-route` — from a circuit's name to a stored Porto route

Status: `todo`
Depends on: [phase-22-route-generator.md](phase-22-route-generator.md) (the
generator this command drives), [phase-1-geometry.md](phase-1-geometry.md)
(`circuits.json`, projection)
Supersedes: [phase-19-circuit-extraction-tooling.md](phase-19-circuit-extraction-tooling.md)
(absorbed — see *Relationship to Phase 19*)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

One dev-only command that takes **a circuit's name** and does everything
needed to end up with its route in Porto, stored and ready for the routes
page:

```sh
npm run find-route -- "Monza"
```

1. **Find the circuit.** If it is already in `circuits.json`, use it.
   Otherwise fetch it: resolve the name to a real-world place and official
   lap length (Wikidata), fetch that place's track geometry (OpenStreetMap,
   via Overpass), assemble the lap as one closed ring, simplify and validate
   it, and append it to `circuits.json`.
2. **Find its route in Porto.** Run Phase 22's generator (pose search →
   map matching → spike pruning, escalating until the acceptance bar is met)
   and write `src/data/routes/<id>.json`.
3. **Report** what was found, plainly: the circuit's source and length, and
   each route's metrics against the bar — including when it misses.

"Offline" in the sense of the whole project: **nothing here runs in the
browser and the shipped site never fetches anything.** The network is used
only by stage 1's one-time data fetch; the matching against Porto (stage 2)
runs entirely against the bundled street network. The outputs are committed
static JSON, exactly like today.

## Relationship to Phase 19

Phase 19 (circuit-extraction tooling, never implemented) took the position
that *finding the OSM source stays human judgement* — the operator supplies
`--relation <id>` after looking at the relation by eye. This phase
**deliberately reverses that**, because the requested interface is the name
alone. What Phase 19 got right is kept: the stitch/simplify/validate
pipeline, `geometry/simplify.ts`, "fail loudly and specifically rather than
guess", nothing written until validation passes, no live network in the
default test suite. What changes is who picks the source: the tool does, by a
rule that must be **checkable against the official length**, and when the rule
cannot decide it stops and shows the candidates instead of guessing. The
manual override (`--relation`/`--way`/`--exclude-ways`) stays, for the cases
the rule cannot settle. Phase 19 is marked `superseded`; its spec is kept for
its reasoning.

## Findings from the 2026-09-21 probe (they shaped the decisions below)

Live requests against Overpass and Wikidata, before writing this spec:

- **A worldwide name search on Overpass does not work.** `nwr[name~"Monza",i]`
  with no area over the whole planet returned no usable result inside two
  minutes. The same question bounded to a 3.5 km radius answered in ~1 s. So
  the name must first be turned into **coordinates**, and Overpass only ever
  queried around them.
- **Wikidata resolves the name and gives the length.** `wbsearchentities`
  finds "Monza Circuit" (Q171417); its claims carry a coordinate (P625) and
  a length (P2043, `+5793` metres, with a start-time qualifier — layout
  history is present, so the statement to use has to be chosen, not taken
  blindly).
- **OSM's own element often names its Wikidata id.** Monza's relation 284565
  (`type=circuit`, `highway=raceway`) carries `wikidata=Q171417`, so the two
  sources can be joined exactly instead of by fuzzy name.
- **One OSM relation can hold several layouts.** Monza's relation has 20
  ways plus a pit-lane way, and around it sit the banked ovals
  (`Sopraelevata Nord/Sud`), a high-speed ring, a junior circuit and the old
  Pirelli circuit. The F1 lap is *one closed ring inside* that set, not "all
  the members stitched". The three bundled circuits show the other two shapes
  — a per-layout relation (Silverstone), a single closed way (Catalunya) — so
  the ring finder has to handle all three uniformly.
- **The public Overpass endpoint rejects a request with no `User-Agent`
  (HTTP 406) and returned HTTP 504 under back-to-back requests.** Retries with
  backoff, a fallback mirror and a local response cache are requirements, not
  polish.

## Decisions locked for this phase

- **Command:** `npm run find-route -- "<name>" [flags]`. Deterministic and
  non-interactive: it never prompts; an ambiguity is a non-zero exit with the
  candidate list printed and the flag that resolves it.
  `generate-route` stays as the low-level "just stage 2" command; both call
  the same in-process function (moved from `scripts/generate-route.ts` into
  `scripts/lib/generate.ts`, no behaviour change).
- **Order of resolution for the name:**
  1. **Already bundled?** Compare against `id` and `name` after
     normalisation (Unicode-NFD accents stripped, case-folded, punctuation
     dropped). A unique match skips stage 1 entirely (unless `--refresh`).
     Several matches → list them, exit 2.
  2. **Wikidata.** `wbsearchentities` (English, limit 10) for the name, then
     one `wbgetentities` for the hits; keep only entities that are motorsport
     racetracks (an instance-of check, class list fixed at implementation and
     recorded in the decision log) **and** have both a coordinate and a
     length. Exactly one → proceed. Several → list with their description
     and length, exit 2 (`--wikidata Q…` picks). None → exit 1 with the
     suggestion to pass `--wikidata`, or `--relation`/`--way` plus
     `--official-length-m` and `--lat/--lon`, to skip this step.
  3. **Official length** = the Wikidata `P2043` statement chosen by: drop any
     with an end-time qualifier (superseded layout), prefer rank `preferred`,
     else the latest start time, else the only one. Units metre, kilometre
     and mile are converted; any other unit is an error. `--official-length-m`
     overrides.
- **Overpass is only ever queried around known coordinates, or by exact
  `wikidata=` tag** — never by a bare name regex. One request returns the
  candidate ways with node ids (`out body; >; out skel qt;`): every
  `highway=raceway` way within `--radius-m` (default 3500) of the coordinate,
  plus the members of any relation whose `wikidata` equals the resolved id
  (which may extend beyond the radius). Shared **OSM node ids** are how ways
  join — exact and topological; the 5 m endpoint tolerance from Phase 19 is
  only a fallback for a gap between two ways that should touch, and is
  reported when used.
- **Choosing the lap is a search, then a length check — not a guess.**
  1. Drop pit-lane ways: member role `pit_lane`, or `name` containing "pit"
     (case-insensitive) — the only automatic exclusions; `--exclude-ways`
     adds more. Everything else raceway-tagged stays a candidate.
  2. Build the way graph (nodes = junction nodes, edges = ways) and
     enumerate its **simple cycles**, capped at `MAX_CYCLES`. Exceeding the
     cap is a loud failure ("too many layouts overlap here — pin ways with
     `--exclude-ways`"), not a truncated search.
  3. Each cycle's length is its metric projected length. Rank by
     `|length / official − 1|`.
  4. **Auto-pick only if** the best is within `PICK_TOLERANCE` (5 %) **and**
     the runner-up is at least `PICK_MARGIN` (3 percentage points) worse.
     Otherwise stop, print the top candidates (way ids, length, error), exit
     2. Wikidata's length is for the layout Wikipedia describes, which can
     differ from the F1 layout; a failure here is the tool correctly refusing
     to guess, and `--official-length-m`/`--exclude-ways` resolve it.
  This one rule covers a per-layout relation, a multi-layout relation and a
  single closed way alike.
- **Downstream of the ring, unchanged from Phase 19:** project to local
  metres (`geo.ts`), `simplify(…, 2.5, true)` (Douglas–Peucker, new
  `geometry/simplify.ts`), round to 6 decimals, assemble the `Circuit`
  (`attribution.url` = the OSM element actually used, `retrieved` = today),
  run `validateCircuits` over the existing list plus the new one (the ±20 %
  cross-check included), then write. Any failure → nothing written.
- **`id`** is a slug of the resolved name (`monza`, `spa-francorchamps`),
  `--id` overrides; a collision with an existing id is an error, not a
  silent overwrite (`--refresh` is the explicit way to re-extract an existing
  circuit).
- **Writes are atomic and ordered.** `circuits.json` is written (temp file +
  rename) only after validation; the route file only after
  `validateRouteFile` (Phase 22's own check). If generation fails or is
  interrupted after extraction, the circuit stays in `circuits.json` —
  valid, and the routes page already shows it as "no route generated yet" —
  and the command prints exactly how to resume:
  `npm run generate-route -- <id>`.
- **Polite, resilient network layer** (`src/extract/http.ts`, the fetch
  function injected so it is testable): a `User-Agent` naming the tool and a
  contact, ≥ 1 s between requests, retry on 429/5xx/empty or non-JSON bodies
  with exponential backoff (`RETRY_BACKOFF_S`), then the fallback endpoint,
  then fail with what was tried. Every response is cached in
  `.cache/find-route/` (gitignored), keyed by a hash of the request, so a
  re-run does not hit the network; `--offline` uses the cache only and fails
  if a needed response is missing.
- **Progress and time are honest.** Stage 1 takes seconds. Stage 2 takes
  what Phase 22 measured (minutes; ~25 min for the hardest bundled circuit
  under heavy machine load) — the command logs each stage and each escalation
  tier as it goes, as `generate-route` already does.
- **The command prints the provenance row** for `circuits.schema.md`'s
  table (as Phase 19 decided: keeping that document accurate stays a
  deliberate human paste, not generated prose). The schema's "Provenance"
  paragraph is updated once, to point at this command instead of describing
  an uncommitted pipeline.

## Flags

| flag | meaning |
| --- | --- |
| `--list` | Resolve and print candidates (Wikidata entities, OSM rings with lengths); write nothing. |
| `--dry-run` | Run stage 1 fully, print the circuit that *would* be added; write nothing, skip stage 2. |
| `--extract-only` | Do stage 1 (writes `circuits.json`), skip stage 2. |
| `--refresh` | Re-extract a circuit that is already bundled (default: reuse it). |
| `--wikidata Q…` | Pick the Wikidata entity; skips name search. |
| `--relation N` / `--way N` | Use this OSM element as the ring source; skips the cycle search's candidate gathering. |
| `--exclude-ways a,b,…` | OSM way ids to drop before the cycle search. |
| `--official-length-m N` | Override the length used for ring choice and validation. |
| `--radius-m N` | Overpass search radius (default 3500). |
| `--id`, `--name`, `--lat`, `--lon` | Override the derived id / display name / centre. |
| `--scale N` | Passed to the generator (as `generate-route`). |
| `--offline` | Use the response cache only. |

## Repository layout after this phase

```text
.cache/find-route/                 # gitignored response cache
scripts/
├── find-route.ts                  # new: thin CLI
├── generate-route.ts              # now a thin CLI over lib/generate.ts
└── lib/
    └── generate.ts                # moved out of generate-route.ts, unchanged behaviour
src/
├── geometry/
│   ├── simplify.ts                # new: Douglas–Peucker (pure) — from Phase 19
│   └── simplify.test.ts
└── extract/                       # new: pure, dev-only (like src/route/); not imported by the app
    ├── names.ts   / names.test.ts       # normalise + match a name against bundled circuits, slug ids
    ├── wikidata.ts / wikidata.test.ts   # parse search + claims (length pick, units), pick entity
    ├── overpass.ts / overpass.test.ts   # query builder, response → ways/nodes, pit-lane filter
    ├── rings.ts    / rings.test.ts      # way graph, cycle enumeration, rank + auto-pick rule
    ├── http.ts     / http.test.ts       # retry/backoff/mirror/cache around an injected fetch
    └── fixtures/                        # small trimmed real responses (Monza, Silverstone, Catalunya shapes)
```

Application code, `circuits.ts` and the data formats are unchanged.

## New / changed code (signatures)

```ts
// extract/names.ts
export function normaliseName(s: string): string
export function matchBundled(query: string, circuits: readonly Circuit[]): Circuit[] // 0, 1 or many
export function slugId(name: string): string

// extract/wikidata.ts
export type TrackEntity = { id: string; label: string; description: string;
  lonLat: [number, number]; lengthM: number }
export function parseSearch(json: unknown): string[]                    // entity ids
export function parseEntities(json: unknown): TrackEntity[]            // racetracks with coord + length only

// extract/overpass.ts
export type OsmWay = { id: number; nodeIds: number[]; points: [number, number][]; tags: Record<string, string>; role?: string }
export function buildQuery(around: { lat: number; lon: number; radiusM: number }, wikidataId: string): string
export function parseWays(json: unknown): OsmWay[]

// extract/rings.ts
export type RingCandidate = { wayIds: number[]; points: [number, number][]; lengthM: number; errorRatio: number }
export function findRings(ways: readonly OsmWay[], maxCycles?: number): RingCandidate[]   // throws on cap
export function rankRings(rings: readonly RingCandidate[], officialLengthM: number): RingCandidate[]
export function pickRing(ranked: readonly RingCandidate[]):
  | { kind: 'picked'; ring: RingCandidate }
  | { kind: 'ambiguous'; top: RingCandidate[] }
  | { kind: 'none'; reason: string }

// geometry/simplify.ts
export function simplify(path: Path, toleranceM: number, closed?: boolean): Point[]
```

## Constants

| name | value | meaning |
| --- | --- | --- |
| `SIMPLIFY_TOLERANCE_M` | `2.5` | Douglas–Peucker tolerance; matches the documented existing pipeline |
| `STITCH_FALLBACK_M` | `5` | endpoint gap tolerated when two ways share no node id (reported when used) |
| `DEFAULT_RADIUS_M` | `3500` | Overpass search radius around the Wikidata coordinate |
| `MAX_CYCLES` | `5000` | cap on enumerated cycles before failing loudly |
| `PICK_TOLERANCE` | `0.05` | best ring must be within 5 % of the official length to be auto-picked |
| `PICK_MARGIN` | `0.03` | runner-up must be at least 3 points worse |
| `MIN_REQUEST_GAP_S` | `1` | politeness gap between network requests |
| `RETRY_BACKOFF_S` | `[2, 4, 8, 16]` | waits before each retry, then the fallback endpoint |
| Endpoints | `https://overpass-api.de/api/interpreter`, then `https://overpass.kumi.systems/api/interpreter` | the fallback's reachability is confirmed at implementation |

`PICK_TOLERANCE` and `PICK_MARGIN` are starting values, tuned against the
three bundled circuits and the new-circuit proof, and the real values
reported in the decision log.

## Tests

The default suite stays fast and **offline** (CONVENTIONS.md): every network
interaction goes through an injected `fetch`, and the fixtures are small
trimmed copies of the real responses above.

- **`simplify.test.ts`** — as Phase 19 specified: collinear points dropped;
  a spike beyond tolerance kept, a wiggle inside dropped; endpoints/seam
  kept; `fast-check` guarantee (every original point within tolerance of the
  result); tolerance `0` is the identity.
- **`names.test.ts`** — accent/case/punctuation-insensitive matching
  ("Autódromo" ↔ "autodromo"); unique, none and multiple matches; slug
  stability.
- **`wikidata.test.ts`** — length statement choice (end-time dropped,
  preferred rank wins, latest start wins, single statement); unit conversion
  for metre/kilometre/mile and rejection of an unknown unit; entities without
  coordinate or length are filtered out; non-racetracks are filtered out.
- **`overpass.test.ts`** — the query is bounded (never contains a bare
  `name~` search) and contains the `wikidata` tag clause; ways reassembled
  from `body` + `skel` with correct node ids; the pit-lane exclusions (role,
  name) and `--exclude-ways`.
- **`rings.test.ts`** — synthetic way graphs: a single closed way; a clean
  cycle split across several ways (order and direction of ways scrambled);
  two overlapping layouts sharing a section (the right one picked by length);
  a figure-eight; a pit lane that would create a shorter false cycle;
  ambiguity (two rings within the margin) → `ambiguous`; nothing within
  tolerance → `none`; the cycle cap throws; a 1–5 m endpoint gap is bridged
  and reported, a 50 m gap is not. Fixture test: the Monza-shaped fixture
  yields the GP ring, not the oval or the union.
- **`http.test.ts`** — fake timers: retry with the configured backoff on
  504/429/empty/non-JSON, then fallback endpoint, then a clear final error;
  the request gap is honoured; cache hit avoids a call; `--offline` with a
  cache miss fails without calling.
- **An integration-style test with everything injected**: name → (fake)
  Wikidata + Overpass fixtures → assembled `Circuit` that passes the real
  `validateCircuits`, and a failing extraction proves `circuits.json` content
  is unchanged (the write function is never reached).
- `scripts/find-route.ts` itself is a thin wiring layer and is not unit
  tested; its real behaviour is the acceptance run below.

## Acceptance criteria

- `npm run build` and `npm run test:run` pass, offline.
- **Reproduction check (once, live, reported in the decision log):**
  `find-route --dry-run --refresh` for Hungaroring, Silverstone and Catalunya
  each either picks the same OSM source as `circuits.schema.md` records with a
  length within a couple of metres of today's `4356`/`5869`/`4667`, or the
  decision log states why the tool chose or refused differently.
- **One genuinely new circuit, end to end, with a single command** from its
  name to a committed `src/data/routes/<id>.json` (a permanent circuit that is
  well mapped — Monza looked promising in the probe, the choice is the
  implementer's and not cherry-picked for ease). It passes `validateCircuits`
  and `routes.test.ts`, and is visible on the routes page if Phase 23 has
  landed.
- **One expected refusal:** Monaco (a street circuit, dropped once already)
  is attempted; the tool either extracts a ring that passes the length check
  or refuses with a diagnostic specific enough to act on. It must never
  write a wrong ring. The outcome is recorded either way.
- `find-route -- "<an already bundled circuit>"` performs no network
  requests and only runs stage 2.
- The provenance table and "Provenance" paragraph in
  `circuits.schema.md` are updated; `docs/ROADMAP.md` updated per the working
  method; a `RELEASES.md` entry is added **only if** the new circuit is
  user-visible in this release (otherwise the entry waits for the release in
  which it appears).

## Not in scope

- **Running the whole calendar.** This makes one circuit one command; the
  ~21-circuit batch (the "Later" item) is that command run per circuit, with
  each street circuit's outcome recorded honestly.
- **Anything at runtime.** No Overpass/Wikidata from the browser; the shipped
  site is unchanged.
- **Interactive prompts** (menus, "did you mean…"). Ambiguity is a printed
  list and a flag.
- **Auto-detecting pit lanes beyond the role/name rule, or repairing messy
  street-circuit tagging** (split carriageways). Refused with a diagnostic;
  manual flags remain.
- **Choosing an `area` label for the route** (Phase 23's optional text). A
  separate question — it cannot come from a runtime geocoder, and deriving it
  from the bundled network's street names is its own small design.
- **Fetching or refreshing `porto-streets.json`.**

## Open questions

- **Which Wikidata classes count as a "motorsport racetrack"?** Monza's
  P31 is `Q2338524` and `Q1497375`; the filter list is decided by trying the
  calendar's circuits, not from memory. Recorded in the decision log.
- **Is `PICK_TOLERANCE = 5 %` right?** Circuit lengths on Wikidata are
  sometimes for a pre-modification layout. If the reproduction check shows a
  correct ring outside 5 %, widen it; if it shows a wrong ring inside,
  tighten `PICK_MARGIN`. Measure, don't assume.
- **Is the fallback Overpass mirror actually reachable and equivalent?**
  Confirm at implementation; swap or drop it if not.
