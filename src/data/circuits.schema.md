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
contributors, licensed **ODbL 1.0**. The first three were retrieved
**2026-09-09** via the Overpass API by a one-off, uncommitted pipeline; every
circuit added since comes from `npm run find-route -- "<name>"`
([Phase 24](../../docs/specs/phase-24-find-route-by-name.md)), which prints the
row for the table below. Both do the same thing: take the raceway ways of the
circuit, drop pit lanes, assemble the lap as one closed ring, project to local
metres, simplify with Douglas–Peucker at a 2.5 m tolerance, and store back as
`[lon, lat]` rounded to 6 decimals. `find-route` chooses the lap itself: it
resolves the name on Wikidata (coordinate and official length), fetches the
ways around it, finds every closed ring they form and takes the one whose
length matches the official one — refusing, with the candidates listed, when it
cannot tell. Rings that stay within 60 m of each other everywhere count as the
same lap. The `retrieved` date is the day of the fetch.

| id | name | OSM source | layout | points | computed / official |
| --- | --- | --- | --- | --- | --- |
| `hungaroring` | Hungaroring | [relation 284557](https://www.openstreetmap.org/relation/284557) (ways `1333262244` + `231328650`) | F1 Grand Prix | 70 | 4356 m / 4381 m |
| `silverstone` | Silverstone Circuit | [relation 51160](https://www.openstreetmap.org/relation/51160) "Silverstone Grand Prix" | F1 Grand Prix (Arena) | 82 | 5869 m / 5891 m |
| `catalunya` | Circuit de Barcelona-Catalunya | [way 831804327](https://www.openstreetmap.org/way/831804327) (closed) | F1 (post-2023, no final chicane) | 75 | 4667 m / 4657 m |
| `monza` | Monza Circuit | [relation 284565](https://www.openstreetmap.org/relation/284565) (20 ways) | F1 Grand Prix | 52 | 5787 m / 5793 m |

Monaco was evaluated and dropped for this phase: its layout runs on public
streets and is mapped in OSM as a mix of `highway=raceway` and ordinary street
ways with split carriageways, from which a single clean centreline could not be
stitched reliably. It remains a roadmap candidate.
`find-route` re-tried it on 2026-09-28 and refused, as designed: around the Wikidata
coordinate OSM holds 43 `highway=raceway` ways but they close into only two tiny
rings (251 m and 172 m against the official 3337 m) — the lap itself is ordinary
streets. Nothing was written.
