# `circuits.json` schema

A JSON array of circuit objects. Loaded and validated by
[`src/circuits.ts`](../circuits.ts) (`validateCircuits`); projected to the local
metric frame by `toMetric`. See
[`docs/specs/phase-1-geometry.md`](../../docs/specs/phase-1-geometry.md).

## Fields

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | Non-empty, unique across the file. Stable identifier. |
| `name` | string | Non-empty. Display name. |
| `location` | `{ lat, lon }` | Nominal centre, informational only. `lat` ∈ [-90, 90], `lon` ∈ [-180, 180]. |
| `officialLengthM` | number | Published lap length in metres. Positive, finite. |
| `attribution` | object | `source`, `license`, `url`, `retrieved` — all non-empty strings. `retrieved` is `YYYY-MM-DD`. |
| `centreline` | `[lon, lat][]` | ≥ 20 points. WGS84, **GeoJSON axis order** (`[lon, lat]`). Open ring: the first point is **not** repeated at the end. No two consecutive points equal. |

## Validation cross-check

The projected metric length of `centreline` (equirectangular projection about
its mean coordinate; see `src/geo.ts`) must be within **±20 %** of
`officialLengthM`. Centrelines are not racing lines, so the band is wide; the
check only catches gross unit or ordering errors.

## Provenance

All centrelines are normalised copies of OpenStreetMap geometry, © OpenStreetMap
contributors, licensed **ODbL 1.0**. Retrieved **2026-09-09** via the Overpass
API. The pipeline: fetch the circuit relation's member ways with geometry, drop
pit-lane ways, stitch the remaining ways into a single ordered ring, project to
local metres, simplify with Douglas–Peucker at a 2.5 m tolerance, and store back
as `[lon, lat]` rounded to 6 decimals.

| id | name | OSM source | layout | points | computed / official |
| --- | --- | --- | --- | --- | --- |
| `hungaroring` | Hungaroring | [relation 284557](https://www.openstreetmap.org/relation/284557) (ways `1333262244` + `231328650`) | F1 Grand Prix | 70 | 4356 m / 4381 m |
| `silverstone` | Silverstone Circuit | [relation 51160](https://www.openstreetmap.org/relation/51160) "Silverstone Grand Prix" | F1 Grand Prix (Arena) | 82 | 5869 m / 5891 m |
| `catalunya` | Circuit de Barcelona-Catalunya | [way 831804327](https://www.openstreetmap.org/way/831804327) (closed) | F1 (post-2023, no final chicane) | 75 | 4667 m / 4657 m |

Monaco was evaluated and dropped for this phase: its layout runs on public
streets and is mapped in OSM as a mix of `highway=raceway` and ordinary street
ways with split carriageways, from which a single clean centreline could not be
stitched reliably. It remains a roadmap candidate.
