# `porto-streets.json` schema

A single object: a simplified, compactly encoded copy of OpenStreetMap
"runnable" street geometry for a fixed bounding box around Porto. Loaded,
validated and decoded by [`src/streets.ts`](../streets.ts)
(`validateStreetNetwork` / `loadStreetNetwork`) and indexed in a uniform spatial
grid (`buildStreetIndex`). See
[`docs/specs/phase-3-street-proximity.md`](../../docs/specs/phase-3-street-proximity.md).
The app never fetches OSM at runtime.

## Fields

| Field | Type | Rules |
| --- | --- | --- |
| `bbox` | `[west, south, east, north]` | Four finite numbers, `west < east`, `south < north`. Coverage area (WGS84 degrees). |
| `grid` | number | Quantisation step in degrees for the encoded ways (`1e-5` ≈ 0.8–1.1 m here). Positive, finite. |
| `attribution` | object | `source`, `license`, `url`, `retrieved` — all non-empty strings. Same validator as `circuits.json` (`src/attribution.ts`). |
| `ways` | `number[][]` | Non-empty. Each way is a **flat, even-length** integer array `[x0, y0, dx1, dy1, dx2, dy2, …]` with ≥ 4 entries (≥ 2 points). |

### Way encoding

Each way is a polyline, delta-encoded on the `grid`-degree lattice anchored at
the bbox south-west corner:

- `x0, y0` — the first point as integer lattice steps east / north of
  `[bbox[0], bbox[1]]`;
- each following `dx, dy` — the step from the previous point.

Decode: `lon = bbox[0] + x * grid`, `lat = bbox[1] + y * grid`, accumulating the
deltas. `loadStreetNetwork` then projects every point into the shared Porto
metric frame (`src/porto.ts`, `portoProjection`).

### Validation rules (`validateStreetNetwork`)

Throws with a descriptive message on the first problem:

- top-level object with `bbox`, `grid`, `attribution`, `ways`;
- `bbox` is four finite numbers with `west < east` and `south < north`;
- `grid` is a positive finite number;
- `attribution` passes the shared attribution validator;
- `ways` is a non-empty array; each way is an even-length array of ≥ 4 finite
  integers;
- every decoded point is two finite numbers, `lon ∈ [-180, 180]`,
  `lat ∈ [-90, 90]`, and inside `bbox` expanded by a 0.002° epsilon;
- no two consecutive points in a way are identical (within 1e-9).

## Provenance

© OpenStreetMap contributors, licensed **ODbL 1.0**. Retrieved **2026-09-10**
via the Overpass API.

Pipeline (one-off, not kept in the repo — matches the Phase 1 approach):

1. Overpass query over the nominal Phase 3 bbox `[-8.68, 41.12, -8.55, 41.20]`:

   ```
   way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|
   primary|pedestrian|footway|path|track|cycleway|steps|service)$"]({{bbox}});
   out geom;
   ```

   (`motorway`/`trunk` and link roads excluded — not runnable.)
2. Split each way into runs of points inside the **final** bbox
   `[-8.688, 41.135, -8.575, 41.183]` (tightened toward the real draggable area
   but pushed west to the Foz do Douro coastline so the whole city is covered —
   see the size note below), drop runs with < 2 points.
3. Douglas–Peucker simplify at **5 m** in the Porto metric frame.
4. Quantise to the `1e-5`° lattice, drop consecutive duplicate lattice points,
   drop ways that fall below 2 points, delta-encode.
5. Write `bbox` + `grid` + `attribution` + `ways`.

## Counts (2026-09-10)

| metric | value |
| --- | --- |
| bbox | `[-8.688, 41.135, -8.575, 41.183]` (~9.4 km × 5.3 km, west edge at the coast) |
| grid | `1e-5`° (max quantisation error ≈ 0.56 m) |
| ways | 26 994 |
| vertices | 70 320 |
| total street length | ~1 617 km |
| file size | 588 563 bytes raw (~575 KB); ~234 KB gzip |

## Size note

The spec's nominal bbox (`[-8.68, 41.12, -8.55, 41.20]`, ~11 km × 9 km) with a
plain `[lon, lat]` array encoding produced a ~1.9 MB file — well over the
≤ 600 KB budget. Per the spec's escape hatch, the bbox was reshaped toward the
actual zoom-14 draggable area (narrower N–S, and shifted west so the west edge
reaches the Foz do Douro coastline — the whole city is covered) and a compact
delta-integer encoding was added, bringing the raw file to ~575 KB (fits the
budget). Panning outside the bbox simply shows no colouring there. Extending the
network beyond Porto — statically or via a "load this area" button — is a future
item (ROADMAP Phase 6+). See the ROADMAP decision-log entry for 2026-09-10.
