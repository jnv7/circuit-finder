# Spec — Phase 3: Street proximity feedback

Status: `done` (2026-09-10) — see *Implementation notes* at the end.
Depends on: [phase-2-map-overlay.md](phase-2-map-overlay.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phase 2 lets the user slide a circuit over Porto by eye. This phase adds the
first bit of feedback: while the overlay moves, colour it by how much of its
length actually sits on top of real streets — a green → amber → red hint that
says "this stretch would be runnable here / this stretch cuts across a block".

It stays a **hint, not a verdict**. Nothing is blocked, nothing snaps, there is
no match score and no "best placement" search (that is Phase 6+). The user still
decides what is close enough — see the *judgement stays with the user* principle
in the vision.

When this phase ships, the user can *see* how street-aligned a placement is, but
still cannot *keep* it (Phase 4) or *trace* the route (Phase 5).

## Decisions locked for this phase

- **Street data: OpenStreetMap, bundled as a static asset.** Same pattern as
  `circuits.json`: a normalised copy lives in the repo (`src/data/porto-streets.json`),
  the app never calls Overpass at runtime. ODbL 1.0; attribution stored in the
  file and shown on the map.
- **Coverage area: a fixed bounding box around Porto**, comfortably larger than
  the Phase 2 initial view so the user can drag a ~5 km circuit anywhere on
  screen and still get feedback. Nominal box
  `[-8.68, 41.12, -8.55, 41.20]` (`[west, south, east, north]`), ~11 km × 9 km.
  Panning the map outside the box is allowed and simply shows no colouring
  there (graceful, not an error).
- **Runnable ways only.** Keep OSM ways whose `highway` is one of
  `residential, living_street, unclassified, tertiary, secondary, primary,
  pedestrian, footway, path, track, cycleway, steps, service`. Drop
  `motorway`/`trunk` and link roads (not runnable, and not what the user wants
  to match). One-way tags, turn restrictions, and surface are ignored — Phase 3
  only needs geometry, not a routable graph.
- **One shared metric frame.** All proximity math runs in a single
  equirectangular projection about a fixed Porto origin
  (`PORTO_ORIGIN = [-8.6291, 41.1579]`, the Phase 2 map centre), *not* per
  circuit. Over this box the distortion is < 0.3 % — same basis as Phases 1–2.
  The Phase 2 `overlayLatLngs` contract is unchanged; proximity re-projects its
  lon/lat output into the Porto frame.
- **Proximity metric.** For each centreline segment, sample it every
  `SAMPLE_M = 5` m and take the fraction of samples within `NEAR_M = 10` m of
  any street. That fraction (0…1) is the segment's *coverage*. It approximates
  "how much of this segment's length is near a street"; 5 m sampling is fine for
  a hint.
- **Colour ramp.** A continuous green → amber → red lerp on coverage:
  `1.0` green `#2e7d32`, `0.5` amber `#f9a825`, `0.0` red `#c62828`.
  Quantised to `LEVELS = 8` buckets for rendering so the layer count is bounded.
- **Spatial index.** A uniform grid over the Porto frame, `CELL_M = 50`. Each
  street segment is inserted into every cell its bounding box touches. A nearest
  query scans the 3×3 (or as many as `maxM` needs) cells around the point and
  returns `min(distance, maxM)`. Built once on load; pure and offline.
- **Faint street layer.** Draw the bundled network as one thin grey
  non-interactive polyline so the user can see what the colouring reacts to.
  Panel toggle, on by default.
- **Render loop.** Overlay re-render (now including the proximity recompute) is
  coalesced through `requestAnimationFrame`: pointer events set a dirty flag and
  schedule a frame instead of rendering synchronously.
- **Tests:** the distance primitive, the grid index, the per-segment proximity,
  and the colour ramp are pure functions with full unit coverage plus a
  brute-force cross-check for the index. Real `porto-streets.json` gets one
  "loads and looks sane" test. The Leaflet glue keeps its single jsdom smoke
  test, extended to assert coloured segments exist.

## Repository layout after this phase

```text
src/
├── porto.ts                 # NEW shared constants: PORTO_CENTER, PORTO_ZOOM, PORTO_ORIGIN, portoProjection()
├── streets.ts               # NEW loader + validation + spatial grid index
├── streets.test.ts
├── geometry/
│   ├── nearest.ts           # NEW distanceToSegment, closestPointOnSegment
│   └── nearest.test.ts
├── app/
│   ├── overlay.ts           # unchanged (proximity re-projects its output)
│   ├── proximity.ts         # NEW per-segment coverage + colour ramp (pure)
│   ├── proximity.test.ts
│   ├── map.ts               # coloured segment layers, street layer, rAF render loop
│   └── map.test.ts          # jsdom smoke test, extended
├── ui/
│   ├── controls.ts          # + legend, "near a street" readout, streets toggle
│   └── controls.test.ts
└── data/
    ├── porto-streets.json   # NEW
    └── porto-streets.schema.md  # NEW schema + provenance
```

`PORTO_CENTER` / `PORTO_ZOOM` move from `app/map.ts` to `src/porto.ts`;
`app/map.ts` re-imports them. No behaviour change.

## Data schema — `src/data/porto-streets.json`

```jsonc
{
  "bbox": [-8.68, 41.12, -8.55, 41.20],       // [west, south, east, north]
  "attribution": {
    "source": "OpenStreetMap contributors",
    "license": "ODbL 1.0",
    "url": "https://www.openstreetmap.org/copyright",
    "retrieved": "2026-09-…"
  },
  "ways": [
    [ [-8.6105, 41.1502], [-8.6098, 41.1511], /* … */ ],
    /* … */
  ]
}
```

### Validation rules (`validateStreetNetwork`)

Throws with a descriptive message on the first problem:

- top-level object with `bbox`, `attribution`, `ways`;
- `bbox` is four finite numbers with `west < east` and `south < north`;
- `attribution` has non-empty string `source`, `license`, `url`, `retrieved`
  (reuse the Phase 1 attribution validator — factor it into a shared helper);
- `ways` is a non-empty array; each way is an array of at least **2**
  `[lon, lat]` pairs; each coord is two finite numbers, `lon ∈ [-180, 180]`,
  `lat ∈ [-90, 90]`, and inside `bbox` expanded by a 0.002° epsilon;
- no two consecutive points in a way are identical (within 1e-9).

## New / changed code

### `src/porto.ts`

```ts
export const PORTO_CENTER: LonLat = [-8.6291, 41.1579]
export const PORTO_ZOOM = 14
export const PORTO_ORIGIN: LonLat = PORTO_CENTER
/** Equirectangular projection shared by all Porto-frame geometry. */
export function portoProjection(): LocalProjection   // localProjection(PORTO_ORIGIN)
```

### `geometry/nearest.ts` (pure)

- `closestPointOnSegment(p: Point, a: Point, b: Point): Point` — foot of the
  perpendicular, clamped to the segment; returns `a` for a degenerate segment.
- `distanceToSegment(p: Point, a: Point, b: Point): number` — `distance(p,
  closestPointOnSegment(p, a, b))`.

### `src/streets.ts`

- `type Street = readonly Point[]` (Porto-frame metres).
- `type StreetNetwork = { bbox: BBox; attribution: Attribution; ways: Street[] }`.
- `loadStreetNetwork(): StreetNetwork` — validate `porto-streets.json`, project
  every way through `portoProjection().toLocal`.
- `type StreetIndex = { nearestDistanceM(p: Point, maxM: number): number }`.
- `buildStreetIndex(ways: readonly Street[], cellM = CELL_M): StreetIndex` —
  uniform grid; insert each segment into every overlapped cell; `nearestDistanceM`
  scans the cells covering `[p−maxM, p+maxM]`, returns `min(best, maxM)`.

### `app/proximity.ts` (pure)

- `type SegmentProximity = { coverage: number; color: string }`.
- `type LapProximity = { segments: SegmentProximity[]; nearFraction: number }`
  — `nearFraction` is the length-weighted mean coverage over the closed ring.
- `lapProximity(metricRing: readonly Point[], index: StreetIndex, opts?): LapProximity`
  — `opts = { nearM?: NEAR_M; sampleM?: SAMPLE_M }`. Walks each segment
  (including the closing one), samples every `sampleM`, computes coverage,
  colours it.
- `proximityColor(coverage: number): string` — the green/amber/red lerp, returns
  `#rrggbb`.
- `quantize(coverage: number, levels = LEVELS): number` — bucket index used by
  the renderer.

### `app/map.ts` (glue)

- Import `PORTO_CENTER` / `PORTO_ZOOM` from `src/porto.ts`.
- On init: `loadStreetNetwork()` + `buildStreetIndex(...)`; draw the faint street
  polyline (one non-interactive `L.polyline` with a `LatLng[][]`), toggled by the
  panel.
- Replace the single visible centreline with **`LEVELS` persistent
  `L.Polyline`s**, one per colour bucket. The fat invisible drag target stays a
  single polyline over the whole ring.
- `render()`:
  1. `overlayLatLngs(circuit, placement)` → lon/lat ring (unchanged);
  2. project the ring into the Porto frame (`portoProjection().toLocal`);
  3. `lapProximity(metricRing, index)`;
  4. group each segment's `[start, end]` latlng pair by `quantize(coverage)`;
     `setLatLngs` on each bucket polyline; set its colour from `proximityColor`;
  5. update the readout: lap / longest straight (Phase 2) **plus** "near a
     street: `Math.round(nearFraction * 100)`%".
- `render()` is invoked only from a rAF-coalesced `scheduleRender()`; `destroy()`
  cancels a pending frame.
- Street-geometry attribution already covers this data (same OSM/ODbL string as
  Phase 2); no second attribution entry needed, but point its text at
  `porto-streets.json`'s `attribution` if it differs.

### `ui/controls.ts`

- `renderControls` gains: a `data-role="proximity"` readout cell, a legend
  (three swatches — *on a street* / *partly* / *off-street* — using the ramp
  endpoints and midpoint), and a `<input type="checkbox" data-role="streets">`
  ("Show streets", checked).
- `updateReadout(root, { lapM, straightM, nearFraction })` — extend the existing
  signature.
- `bind` gains `onToggleStreets(show: boolean)`.
- Still pure render-to-string + explicit `bind`.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `NEAR_M` | `10` | a sample is "on a street" within this distance |
| `SAMPLE_M` | `5` | spacing of coverage samples along a segment |
| `CELL_M` | `50` | spatial grid cell size |
| `LEVELS` | `8` | colour buckets for rendering |

All in one place (`app/proximity.ts` for the first two + `LEVELS`, `streets.ts`
for `CELL_M`).

## Tests

All offline. Pure modules stay in the default vitest environment; the map test
keeps `// @vitest-environment jsdom`.

- **`nearest`**: perpendicular foot inside a segment; clamps past each end;
  degenerate segment returns the point-to-`a` distance; symmetry in `a`/`b`.
- **`streets`**: `validateStreetNetwork` rejects each malformed shape;
  `buildStreetIndex` + `nearestDistanceM` agrees with a brute-force scan over all
  segments on random points (`fast-check`, fixed seed); the `maxM` cap is
  honoured; a point far from everything returns exactly `maxM`.
- **`proximity`**:
  - a ring laid exactly on a straight test street → every segment `coverage ≈ 1`,
    colour green, `nearFraction ≈ 1`;
  - the same ring translated 500 m into open space → `coverage ≈ 0`, red,
    `nearFraction ≈ 0`;
  - a ring half on / half off a street → the on-street segments green, the
    off-street segments red, `nearFraction ≈ 0.5`;
  - `proximityColor(0|0.5|1)` are the three stops; a value between two stops is
    a componentwise interpolation; output always matches `/^#[0-9a-f]{6}$/`;
  - `quantize` maps `[0,1]` onto `0…LEVELS-1` monotonically.
- **`controls`**: rendered HTML has the legend, the streets checkbox (checked),
  and the proximity cell; `bind` fires `onToggleStreets` with the checkbox
  state; `updateReadout` writes the "% near a street" value.
- **`porto-streets.json` (real data)**: `loadStreetNetwork()` succeeds; way
  count and total vertex count are within sane bounds; every vertex lies in the
  bbox; the file is under the size budget (see below).
- **`map` (jsdom)**: after `createMapApp`, the container has coloured centreline
  segments (≥ 1 polyline with a ramp colour) and the faint street layer;
  `destroy()` still tears down without throwing and cancels the pending frame.

## Data pipeline (one-off, not kept in the repo)

Matches the Phase 1 approach:

1. Overpass: `way["highway"~"^(residential|living_street|unclassified|tertiary|
   secondary|primary|pedestrian|footway|path|track|cycleway|steps|service)$"]
   ({{bbox}}); out geom;` for the bbox above.
2. Split into ways, drop ways with < 2 nodes, snap coords to 6 decimals.
3. Douglas–Peucker simplify at **4 m** in the Porto frame.
4. Write `porto-streets.json` with `bbox` + `attribution` + `ways`.
5. Record the query, date, and resulting counts in `porto-streets.schema.md`.

## Size budget

`porto-streets.json` should stay **≤ ~600 KB raw** (gzips to well under
150 KB). If it comes in heavier, tighten the bbox toward the actual draggable
area or raise the DP tolerance to 6 m before adding any encoding scheme. Report
the real numbers in the ROADMAP decision-log entry. The JS bundle otherwise
gains nothing but the small pure modules.

## Acceptance criteria

- `npm run dev`: as the user drags or rotates the overlay, its centreline
  recolours live green → amber → red by street proximity; a faint Porto street
  layer is visible (and can be toggled off); a legend explains the ramp.
- The panel shows a live "near a street: NN %" figure that changes as the
  overlay moves and updates when the circuit or scale changes; it is absent from
  / independent of the lap-length and longest-straight readouts.
- The colouring never blocks a placement, never moves the overlay, and shows no
  numeric "match score" — it is purely advisory.
- No runtime network request. OSM/ODbL attribution for the street data is
  visible on the map.
- `npm run test:run` and `npm run build` pass. The only bundle-size change of
  note is `porto-streets.json`; its size is reported.
- `docs/ROADMAP.md` (Phase 3 → `done`, dated decision-log entry, priority → Phase
  4) and `RELEASES.md` updated per the working method.

## Not in scope

- Automatic placement, shape matching, or any "best fit" search (Phase 6+).
- Snapping the overlay — or later a traced route — to the street network
  (Phase 5 / 6+).
- Route tracing and deviation measurement (Phase 5).
- Saving / restoring / exporting a placement (Phase 4).
- Treating the streets as a routable graph (connectivity, one-ways, turn
  restrictions); Phase 3 uses geometry only.
- Street data outside the fixed Porto bbox, or freeing the map area (Phase 6+).
- Elevation, surface type, lighting, or any non-geometric street attribute.
- Per-segment length readouts or any breakdown beyond the single "% near a
  street" figure and the colour.

## Implementation notes (2026-09-10)

Built as specified, with these deviations:

- **Street data encoding & bbox.** The nominal bbox as plain `[lon, lat]` arrays
  came in at ~1.9 MB, far over the ≤ 600 KB budget. Applying the spec's escape
  hatch: the bbox was reshaped to the real zoom-14 draggable area
  (`[-8.688, 41.135, -8.575, 41.183]`, ~9.4 × 5.3 km — narrower N–S than nominal,
  west edge on the Foz do Douro coastline so the whole city is covered) **and**
  `porto-streets.json` now stores each way as a flat delta-integer array on a
  `1e-5`° lattice (`grid` field; max quantisation error ≈ 0.56 m).
  `validateStreetNetwork` decodes and then applies the coordinate rules from the
  spec. Final file: 26 994 ways / 70 320 vertices / 588 563 bytes raw / ~234 KB
  gzip. DP tolerance 5 m. Full detail in
  [`src/data/porto-streets.schema.md`](../../src/data/porto-streets.schema.md).
  Extending coverage past this box is a Phase 6+ item (see ROADMAP).
- **Bundling.** `porto-streets.json` is imported (inlined into the JS bundle,
  like `circuits.json`) rather than fetched, so there is still no runtime
  request; the production chunk is ~768 KB / ~295 KB gzip and
  `build.chunkSizeWarningLimit` is raised to 800.
- **`updateReadout` signature** became `updateReadout(root, { lapM, straightM,
  nearFraction })` (object, not positional) since it now carries three values.
- **rAF coalescing** applies to the pointer-interaction re-renders
  (`scheduleRender`); the initial mount still renders synchronously so the first
  paint (and the jsdom smoke test) needs no frame tick.
- Attribution validation was factored into `src/attribution.ts` and shared by
  `circuits.ts` and `streets.ts`, as the spec suggested.
