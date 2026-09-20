# Generated route files (`src/data/routes/<circuitId>.json`)

One file per circuit, written by `npm run generate-route -- <circuitId>`
(Phase 22) and read by the routes page (Phase 23). Never hand-edited —
`routes.test.ts` recomputes every stored route's metrics from its own
`points`/`pose` and the bundled street graph, so a stale or hand-edited file
fails the default test suite.

Validated and typed by `src/routes.ts`'s `validateRouteFile`/`loadRouteFile`.

## Shape

```ts
type RouteFile = {
  schemaVersion: 1
  circuitId: string // must exist in circuits.json
  generatedAt: string // YYYY-MM-DD
  scale: number // 1 unless --scale was given to the generator
  generator: {
    poses: number // candidate poses searched at the tier used
    escalationTier: number // 0, 1, or 2 — see docs/specs/phase-22-route-generator.md
    bar: { meanM: number; maxM: number; ratioLo: number; ratioHi: number; retrace: number }
  }
  streets: Attribution // same shape as porto-streets.json's attribution
  routes: {
    rank: number // 1 = best, ranked 1..n in order
    passesBar: boolean
    area?: string // free text naming where it is, e.g. "Ribeira and Baixa, north bank of the Douro"
    pose: { anchor: [number, number]; rotationRad: number } // [lon, lat]; scale is the file's own
    points: [number, number][] // [lon, lat], closed loop: first point NOT repeated
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

## Conventions

- `points` follows `circuits.json`'s convention: GeoJSON axis order
  (`[lon, lat]`), open ring (the first point is not repeated). A consumer
  needing a closed polyline (GPX, drawing) appends the first point itself.
- The circuit outline is **not** stored in this file — it is
  `circuits.json`'s own centreline placed with `pose` and `scale`
  (`geo.ts`'s `placePoints`), so a route file can never disagree with the
  circuit data it was generated from.
- `generator.bar` records the acceptance bar the generator judged this file's
  routes against **at the time it was generated** — a provisional bar (see the
  ROADMAP decision log) that may be revised later; a route's own `passesBar`
  always reflects the bar stored alongside it, not today's constant.
- A route that misses the bar is stored anyway, with its real numbers —
  never hidden, never silently dropped.

## Attribution

`streets` carries the same OpenStreetMap attribution as
`porto-streets.schema.md`, since every route is built entirely from that
bundled network.
