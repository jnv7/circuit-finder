# Spec — Phase 1: Circuit data + geometry toolkit

Status: `done` (2026-09-09)
Depends on: [phase-0-skeleton.md](phase-0-skeleton.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Turn the placeholder circuit list into real, normalised circuit geometry, and
build the pure geometry functions the acetate workflow needs. Still no map and no
overlay — this phase ships a tested library plus a text page that proves the data
loads: for each circuit, its lap length and longest straight computed from the
stored centreline.

Everything here is pure and offline. Phase 2 consumes this toolkit to draw and
drag the overlay on a Leaflet map.

## Decisions locked for this phase

- **Geometry source: OpenStreetMap.** Circuit centrelines are derived from OSM
  raceway ways (`highway=raceway`, combined into one closed ring per circuit).
  Licensed ODbL 1.0; per-circuit attribution is stored in the data file. A
  normalised copy lives in the repo — the app never fetches OSM at runtime.
  (Resolves the "geometry source" open question in the roadmap.)
- **Bundled circuits (3):** `hungaroring`, `silverstone`, `catalunya`
  (Barcelona-Catalunya). All three are cleanly mapped in OSM as connected
  `highway=raceway` ways and are shape-diverse (twisty infield / fast open track
  / mixed), which makes the geometry tests meaningful.
  - _Substituted during implementation:_ Monaco was dropped. Its layout runs on
    public streets and is represented in OSM as a mix of `highway=raceway` and
    ordinary street ways with split carriageways near Casino; stitching a clean
    single centreline from it is data archaeology out of proportion to this
    phase. Hungaroring (current F1 calendar, distinctive shape) took its place.
    Monaco and Madrid (IFEMA) return as roadmap candidates.
- **Stored coordinates are geographic.** `centreline` is an array of
  `[lon, lat]` pairs (WGS84, GeoJSON axis order), an open ring (first point is
  not repeated at the end). This is the honest normalised source and is easy to
  eyeball against a map.
- **Geometry math runs in a local metric frame.** The loader projects each
  centreline to metres in a local ENU plane (x = east, y = north) with the
  origin at the ring centroid, using an equirectangular approximation about that
  centroid. Good to well under 1% over a few km; a proper tangent-plane / UTM
  projection is a later refinement if ever needed. The inverse projection
  (metres → lon/lat around a placement anchor) is Phase 2.
- **Similarity transform only:** uniform positive scale, rotation, translation.
  No reflection. Orientation of the ring is preserved.
- **Simple rings only.** Centrelines are assumed non-self-intersecting.
  Figure-eight layouts (Suzuka) are out of scope for this phase.
- **Property tests:** add `fast-check` as a dev-only dependency. Offline, no
  keys, standard tool for the rotate/scale-invariant tests the roadmap calls
  for.
- **Angles in radians** throughout the geometry code. Formatting to degrees, if
  ever needed, happens at the UI edge.

## Repository layout after this phase

```text
src/
├── main.ts                  # updated: shows length + longest straight per circuit
├── circuits.ts              # updated: full schema, validation, metric projection
├── circuits.test.ts         # updated
├── geo.ts                   # equirectangular projection helpers
├── geo.test.ts
├── geometry/
│   ├── types.ts             # Point, Path, SimilarityTransform, Straight
│   ├── vector.ts            # 2D vector ops
│   ├── vector.test.ts
│   ├── path.ts              # pathLength, resample, centroid, signedArea, bounds, recenter
│   ├── path.test.ts
│   ├── transform.ts         # apply / compose / invert similarity transforms
│   ├── transform.test.ts
│   ├── straight.ts          # longestStraight
│   ├── straight.test.ts
│   └── testing.ts           # test-only fast-check shape/transform arbitraries
└── data/
    ├── circuits.json        # new schema, real geometry
    └── circuits.schema.md   # human-readable schema + provenance notes
```

## Data schema — `src/data/circuits.json`

An array of circuit objects:

```jsonc
{
  "id": "monaco",
  "name": "Circuit de Monaco",
  "location": { "lat": 43.7347, "lon": 7.4206 },  // nominal centre, informational
  "officialLengthM": 3337,                          // published lap length
  "attribution": {
    "source": "OpenStreetMap contributors",
    "license": "ODbL 1.0",
    "url": "https://www.openstreetmap.org/relation/…",
    "retrieved": "2026-09-…"
  },
  "centreline": [ [7.4201, 43.7369], [7.4205, 43.7366], /* … */ ]
}
```

### Validation rules (`validateCircuits`, extending Phase 0)

Throws with a descriptive message on the first problem:

- All Phase 0 rules (array, non-empty, `id`/`name` non-empty, `location` in
  range, unique `id`).
- `officialLengthM` is a positive finite number.
- `attribution` has non-empty string `source`, `license`, `url`, `retrieved`.
- `centreline` is an array of at least **20** `[lon, lat]` pairs; each is a
  two-number tuple with `lon` in [-180, 180], `lat` in [-90, 90].
- The ring is **open**: first and last points are not equal (within 1e-9).
- No two consecutive points are equal (within 1e-9).
- Cross-check: the metric length of the projected centreline is within
  **±20%** of `officialLengthM` (centreline ≠ racing line, so the band is
  wide; this only catches gross unit/order errors).

## Geometry toolkit

### `geometry/types.ts`

```ts
export type Point = readonly [number, number];        // metres: x east, y north
export type Path = readonly Point[];                   // open ring unless noted

export type SimilarityTransform = {
  readonly translate: Point;   // metres
  readonly rotation: number;   // radians, counter-clockwise
  readonly scale: number;      // > 0, uniform, no reflection
};

export type Straight = {
  readonly startIndex: number; // index into the path
  readonly endIndex: number;   // inclusive; may wrap for a closed path
  readonly lengthM: number;    // summed segment length along the run
  readonly bearing: number;    // radians, chord direction start→end, atan2(dx, dy) style — document the convention in code
};
```

### `geometry/vector.ts`

Pure 2D helpers on `Point`: `add`, `subtract`, `scale(v, k)`, `rotate(v, rad)`,
`length(v)`, `distance(a, b)`, `dot`, `cross`, `normalize`. Small and obvious;
each gets a direct unit test.

### `geometry/path.ts`

- `pathLength(path, closed = true): number` — sum of segment lengths; when
  `closed`, includes the closing segment last→first.
- `resample(path, spacingM, closed = true): Point[]` — points spaced evenly by
  arc length. `spacingM` must be > 0. Returns roughly `round(pathLength /
  spacingM)` points; for a closed path the result is an open ring (no repeated
  closing point). First point coincides with `path[0]`.
- `centroid(path): Point` — area centroid of the closed polygon; falls back to
  the vertex mean if the signed area is ~0.
- `signedArea(path): number` — shoelace; positive for counter-clockwise.
- `bounds(path): { min: Point; max: Point }`.
- `recenter(path): Point[]` — translate so the centroid is at the origin.

### `geometry/transform.ts`

- `IDENTITY: SimilarityTransform`.
- `apply(t, p): Point` — order is **scale → rotate → translate**.
- `transformPath(t, path): Point[]`.
- `compose(a, b): SimilarityTransform` — the transform equivalent to applying
  `b` then `a`. Scales multiply, rotations add, translate composes correctly.
- `invert(t): SimilarityTransform`.

### `geometry/straight.ts`

`longestStraight(path, opts?): Straight` where
`opts = { maxTurnRad?: number; closed?: boolean }`, defaults
`maxTurnRad = 0.12` (~6.9°), `closed = true`.

Algorithm:

1. Build the segment list (for `closed`, include last→first).
2. At each joint between consecutive segments, compute the turn angle =
   unsigned angle between the two direction vectors (0…π).
3. A **run** is a maximal sequence of consecutive segments whose every internal
   joint has turn ≤ `maxTurnRad`.
4. For a closed path, rotate the segment indexing to start at a joint whose turn
   exceeds `maxTurnRad`, so runs are not split by the array seam. If no such
   joint exists (path is essentially circular), the whole loop is one run.
5. Return the run with the greatest summed segment length; tie-break on the
   lowest `startIndex`. `bearing` is the chord direction from the run's first
   point to its last point.

## Tests

Colocated `*.test.ts`, all offline. Unit tests for every exported function plus
these property tests (`fast-check`, fixed seed):

- **`pathLength`** scales by exactly `scale` under a similarity transform and is
  invariant (within epsilon) under rotation and translation alone.
- **`resample`**: consecutive spacing ≈ `spacingM` (within a few percent except
  possibly the wrap segment); resampled path length ≈ original within tolerance;
  idempotent-ish (resampling twice at the same spacing barely moves points).
- **`transform`**: `compose(t, invert(t))` ≈ `IDENTITY` applied to points;
  `apply(IDENTITY, p) === p`; `signedArea` keeps its sign under any transform
  (no reflection); area scales by `scale²`.
- **`longestStraight`**: on a synthetic rounded rectangle the result equals the
  known long side; `lengthM` scales by `scale`; `bearing` rotates by `rotation`
  (mod 2π); the selected index range is stable under rotation/translation.
- **circuit data**: every bundled circuit round-trips through `validateCircuits`;
  projected length is within ±20% of `officialLengthM`; `longestStraight` for
  each is a sane fraction of the lap (roughly 3–35%).

Update `circuits.test.ts` and `main.ts` for the new schema (the Phase 0 tests
referencing only `id`/`name`/`location` still hold; add coverage for the new
fields).

## Application slice — `main.ts`

Extend the existing page (no map yet): for each circuit render name, official
length, computed centreline length, and longest-straight length. Render the OSM
attribution once at the foot of the page. `renderCircuitList` stays a pure
HTML-string function; extend it and its test.

## Acceptance criteria

- `npm run test:run` passes, including the property tests.
- `npm run build` is clean (`tsc --noEmit` + Vite build).
- `npm run dev` shows the three circuits with official vs computed length and
  longest straight, plus OSM attribution.
- `src/data/circuits.json` has three circuits with real centrelines and complete
  `attribution` blocks; `circuits.schema.md` documents the schema and records
  where each centreline came from and when.
- `fast-check` is in `devDependencies` only; the production bundle is unchanged
  in dependencies.
- `docs/ROADMAP.md` updated: Phase 1 → `done`, dated decision-log entry, current
  priority moved to Phase 2; the "geometry source" open question marked
  resolved.

## Implementation notes (2026-09-09)

- **Data pipeline.** Circuit relations pulled from Overpass (`relation(id);
  way(r); out geom;`). Member ways stitched into one ring: Hungaroring and
  Silverstone from ordered relation members (pit-lane ways dropped), Catalunya
  straight from its single closed `way 831804327`. Rings projected to metres,
  simplified with Douglas–Peucker at **2.5 m** (70–82 points each), stored as
  `[lon, lat]` at 6 decimals. Total `circuits.json` ≈ 9 KB. One-off scripts were
  not kept in the repo.
- **Circuit swap.** Monaco replaced by Hungaroring — see the decision above.
- **Results.** 48 tests pass. Computed vs published lap length: Hungaroring
  4356/4381 m, Silverstone 5869/5891 m, Catalunya 4667/4657 m (all < 0.7 %).
  Detected longest straights: Silverstone ~760 m (Hangar Straight ≈ 770 m),
  Catalunya ~1058 m (main straight ≈ 1047 m) — both plausible. Production bundle
  12 KB (`fast-check` not included; dev-only).
- **`longestStraight` edge behaviour.** When no joint exceeds `maxTurnRad` (a
  near-circular path) the whole loop is returned as one run with
  `startIndex === endIndex`.

## Not in scope

- Any map, Leaflet, projection to screen pixels, or the inverse (metres →
  lon/lat) projection.
- Dragging, rotating, or rendering the overlay.
- Persistence, export/import.
- Self-intersecting / figure-eight circuits.
- Elevation.
- Runtime fetching of OSM or any external dataset.
- Automatic shape matching or scoring.
