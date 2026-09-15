# Spec — Phase 18: GPX export of the traced route

Status: `todo`
Depends on: [phase-5-trace-and-study.md](phase-5-trace-and-study.md),
[phase-7-street-graph.md](phase-7-street-graph.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

A quick win, flagged in the 2026-09-15 product-direction review: the app can
already build a real, street-following route (Phase 5/7's tracing, or a
committed Phase 14 skeleton) and measure it precisely, but the only place
that route exists is inside the browser tab. There is no way to actually take
it out into the real world for the run it was built for — the single most
literal gap between "the app found me a route" and "I can go run it."

`AppState.route` and the routed polyline `app/map.ts` already computes
(`expandRouteWithGaps`) are exactly the data a GPX file needs; turning them
into a downloadable file is a small, self-contained, static-site-friendly
feature — no backend, no new dependency, matches CONVENTIONS.md's stack
constraints exactly as written.

## How it stays true to the vision

- **"Save an attempt... export/import it as a file"** is literally in
  VISION.md's goals list; GPX export is the "take it with you" half of that
  (JSON export/import of a `SavedPlacement`, the other half, stays a
  separately-scoped later item — see *Not in scope*).
- **Static and free.** A client-side `Blob` + a synthetic download link — the
  same static-site-only mechanism this whole app is built on, no server
  round-trip.
- **Real scale by default.** The exported track is the same routed polyline
  already measured and shown as "Route length" in the panel — no separate
  computation, no risk of the file disagreeing with what the user saw.

## Decisions locked for this phase

- **Exports the *routed* polyline, not the raw clicked/committed
  waypoints.** `app/map.ts` already computes `expandedRouteWithGaps().points`
  (Porto-frame metres, following real streets with straight "gap" segments
  where the network doesn't connect) for rendering and for the route-stats
  readout — the GPX file should contain exactly that path, converted back to
  `[lon, lat]`, so what the user downloads matches what they saw drawn on the
  map and measured in the panel, not a sparser set of waypoints they'd have
  to re-interpolate.
- **`<trk>`, not `<rte>`.** GPX's track element (an ordered sequence of
  points meant to be *followed*) is the broadly-compatible choice for "here
  is a path to run" — the same element Strava/Komoot-style route exports use
  — over `<rte>` (turn-by-turn routing waypoints, a different use case
  VISION.md's non-goals already exclude).
- **No elevation, no timestamps.** `<ele>` and `<time>` are both optional in
  GPX and both irrelevant here — VISION.md's own non-goals list "elevation /
  altitude matching" explicitly, and a route is a path, not a recorded
  activity. Plain `<trkpt lat="…" lon="…">`, nothing else per point.
- **A new pure module, `app/gpx.ts`, builds the XML string**; `app/map.ts`
  wires a button that creates a `Blob`, a synthetic `<a download>`, clicks it,
  and revokes the object URL — the same minimal, dependency-free pattern
  every browser-side "download this file" feature uses, isolated from the
  pure string-building so the format itself is unit-testable without a DOM.
- **Filename**: `${circuitId}-${YYYY-MM-DD}.gpx` (today's date, not
  `savedAt` — the export reflects the *live* route, which may not be saved
  yet) — descriptive, sortable, collision-avoiding across circuits.
- **Button placement: next to "Study view"**, in `renderRouteSection`
  ([controls.ts:217-239](../../src/ui/controls.ts)) — same visibility
  condition (`view.routeStats` present), since a GPX file only makes sense
  once there is a real measured route to export.
- **Disabled/absent when there is nothing to export** — fewer than 2 route
  points (mirrors `routeStats`'s own "nothing meaningful to measure" case,
  [trace.ts:151-160](../../src/app/trace.ts)), not a button that produces an
  empty or single-point file.

## Repository layout after this phase

```text
src/
├── app/
│   ├── gpx.ts         # new: buildGpx (pure)
│   ├── gpx.test.ts     # new
│   ├── map.ts          # + export button wiring
│   └── map.test.ts      # extended
└── ui/
    ├── controls.ts      # + "Export GPX" button in the route section
    └── controls.test.ts # extended
```

No change to `AppState`, `SavedPlacement`, `placements.ts`, or any schema —
this phase reads existing state, it doesn't add any.

## New / changed code

### `src/app/gpx.ts` (new, pure)

```ts
import type { LonLat } from '../geo'

/** Build a GPX 1.1 document containing one `<trk>` with a single `<trkseg>`
 *  of the given points, in order. `points` must have at least 2 entries —
 *  the caller (`app/map.ts`) already gates the export button on that. */
export function buildGpx(points: readonly LonLat[], trackName: string): string {
  const escaped = trackName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const trkpts = points
    .map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="circuit-finder" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escaped}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

/** "hungaroring-2026-09-15.gpx". Pure — `now` injected for testability. */
export function gpxFilename(circuitId: string, now: Date): string {
  const iso = now.toISOString().slice(0, 10)
  return `${circuitId}-${iso}.gpx`
}
```

### `src/app/map.ts`

```ts
import { buildGpx, gpxFilename } from './gpx'

// In the controls handlers:
onExportGpx() {
  const expanded = expandedRouteWithGaps()
  if (expanded.points.length < 2) return
  const circuit = circuitById(state.circuitId)
  const points = expanded.points.map((p) => project.toLonLat(p))
  const gpx = buildGpx(points, circuit.name)
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = gpxFilename(state.circuitId, new Date())
  a.click()
  URL.revokeObjectURL(url)
},
```

### `src/ui/controls.ts`

```ts
export type ControlsHandlers = {
  // ...existing...
  onExportGpx(): void
}
```

`renderRouteSection` gains, alongside the existing `Study view` button:

```ts
${view.routeStats ? '<button type="button" data-role="export-gpx">Export GPX</button>' : ''}
```

`bind` wires `data-role="export-gpx"` to `handlers.onExportGpx`, same
pattern as every other button.

## Constants

None.

## Tests

- **`app/gpx.test.ts`**:
  - `buildGpx` output is well-formed XML with exactly one `<trk>`, one
    `<trkseg>`, and one `<trkpt>` per input point, each `lat`/`lon`
    attribute matching the input in order.
  - `trackName` containing `&`, `<`, `>`, `"` is escaped in `<name>`.
  - `gpxFilename('hungaroring', new Date('2026-09-15T12:00:00Z'))` →
    `'hungaroring-2026-09-15.gpx'`.
- **`ui/controls.test.ts`**: the route section renders the "Export GPX"
  button when `routeStats` is present, omits it otherwise (mirrors the
  existing "Study view" button test); `bind` fires `onExportGpx` on click.
- **`app/map.test.ts` (jsdom)**: with a traced route present, clicking
  `data-role="export-gpx"` calls `onExportGpx`'s underlying logic — assert
  via a stubbed `URL.createObjectURL`/`Blob` (jsdom doesn't implement file
  downloads) that a `Blob` of type `application/gpx+xml` was created and an
  anchor's `click()` was invoked; with no route, the button is absent (no
  need to test a click that can't happen).

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run dev`: with a route traced (or a Phase 14 skeleton committed),
  **Export GPX** downloads a `.gpx` file; opening it in a real GPS/running
  app (or a GPX viewer) shows the same path the map drew, in the same real
  scale.
- No route present → no export button, consistent with "Study view"'s
  existing gating.
- `docs/ROADMAP.md` updated per the working method.

## Not in scope

- **JSON export/import of a `SavedPlacement`** (the other half of VISION's
  "save an attempt... export/import it as a file" goal, explicitly dropped
  from Phase 4 and still in the *Later* list) — a different file format and
  a different use case (hand-carrying a placement between machines vs.
  taking a route onto a GPS device), not bundled here.
- **Elevation or timing data** — explicitly excluded per VISION's own
  non-goals.
- **Exporting a *hovered/previewed* placement** — only the live, measured
  route (`state.route`), matching every other route-stats-gated feature in
  the panel.
