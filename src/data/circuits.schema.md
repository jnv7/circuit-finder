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
circuit added since comes from `npm run extract-circuit -- "<name>"`
([Phase 24](../../docs/specs/phase-24-find-route-by-name.md), split from
`find-route` into its own `extract-circuit` command in
[Phase 27](../../docs/specs/phase-27-split-extraction-and-search-cli.md)),
which prints the row for the table below. Both do the same thing: take the
raceway ways of the circuit, drop pit lanes, assemble the lap as one closed
ring, project to local metres, simplify with Douglas–Peucker at a 2.5 m
tolerance, and store back as `[lon, lat]` rounded to 6 decimals.
`extract-circuit` chooses the lap itself: it
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
| `baku-city` | Baku City Circuit | [relation 11266687](https://www.openstreetmap.org/relation/11266687) | F1 Grand Prix | 51 | 5961 m / 6003 m |
| `madring` | Madring | [relation 18813472](https://www.openstreetmap.org/relation/18813472) (22 ways) | F1 Grand Prix | 88 | 5431 m / 5414 m |
| `las-vegas-strip` | Las Vegas Strip Circuit | [relation 16696508](https://www.openstreetmap.org/relation/16696508) (80 ways) | F1 Grand Prix | 56 | 6194 m / 6201 m |
| `yas-marina` | Yas Marina Circuit | [way 168477013](https://www.openstreetmap.org/way/168477013) (8 ways) | F1 Grand Prix (2021 reconfiguration) | 79 | 5265 m / 5281 m |
| `bahrain-international` | Bahrain International Circuit | [way 4818385](https://www.openstreetmap.org/way/4818385) (3 ways) | F1 Grand Prix | 64 | 5409 m / 5412 m |
| `lusail-international` | Lusail International Circuit | [way 152483595](https://www.openstreetmap.org/way/152483595) (2 ways) | F1 Grand Prix | 79 | 5416 m / 5419 m |

Yas Marina needed two manual overrides, 2026-10-04: Wikidata's `Q172869` still
carries the *pre-2021* lap length (5554 m); the circuit's 2021 reconfiguration
(turns 4–6 merged into one hairpin, turns 11–14 into one banked sweep) brought
it to 5281 m, passed by hand with `--official-length-m`. Even on the corrected
target, the ring search stayed genuinely ambiguous: two closed rings score
0.1% and 0.3% off, 21 m apart in total length, differing by whether a short
pair of ways (`1011722701`, `188861937` — created Dec 2021, just after the
reconfiguration debuted) is part of the lap. Their omission was decided by
the closer length match and by `188861944`/`188861946` (the alternative,
included pair) being the more recently refined geometry (edited Dec 2024
vs. the pair's last edit Aug 2022) — not something the tool could tell by
length alone. Picked with the new `--pick 1`, added to `find-route`/`extractCircuit` this
session: pins a specific candidate from an `ambiguous-ring` refusal's printed
list instead of only being able to widen `--exclude-ways`.

Monaco was evaluated and dropped for this phase: its layout runs on public
streets and is mapped in OSM as a mix of `highway=raceway` and ordinary street
ways with split carriageways, from which a single clean centreline could not be
stitched reliably. It remains a roadmap candidate.
`find-route` re-tried it on 2026-09-28 and refused, as designed: around the Wikidata
coordinate OSM holds 43 `highway=raceway` ways but they close into only two tiny
rings (251 m and 172 m against the official 3337 m) — the lap itself is ordinary
streets. Nothing was written.
