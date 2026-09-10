# Spec — Phase 5: Trace & study

Status: `todo`
Depends on: [phase-2-map-overlay.md](phase-2-map-overlay.md),
[phase-3-street-proximity.md](phase-3-street-proximity.md),
[phase-4-save-restore-export.md](phase-4-save-restore-export.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phases 2–4 let the user place a circuit over Porto, see how street-aligned it is,
and save the placement. This phase closes the loop from the vision: **draw the
actual running route** along real streets under the overlay, see how long it is
and how far it strays from the circuit shape, and get a clean view to
**memorise** it before the run.

From the vision:

> Trace the actual running route along real streets, following the overlay.
> \[…] The primary output is a clear map view to **study and memorise** the
> route.

When this phase ships the manual "acetate" workflow is complete end to end:
place (2) → judge (3) → keep (4) → **trace and study (5)**.

## What this phase is not

- **Not** a routing engine. Clicking traces straight segments between the points
  the user clicks; nothing snaps to the street graph, nothing auto-routes.
  Snapping a traced route to the network is **ROADMAP Phase 6+**.
- **Not** a match score. The route stats are plain measurements (a length, a
  distance in metres), never a single "how close is this" percentage — same
  reasoning as Phase 3's advisory-only colouring and the *judgement stays with
  the user* principle.
- **Not** an image exporter. "Study view" strips the UI for a clean screenshot
  or browser print; a rendered-PNG download and a dedicated print stylesheet are
  future items.

## Decisions locked for this phase

- **Trace input: free clicking.** In trace mode, a click on the map appends a
  vertex to the route; the route is the open polyline through those vertices.
  The Phase 3 street layer stays visible as the thing the user is following by
  eye. No snapping, no nearest-street correction (Phase 6+).
- **Trace mode is an explicit toggle.** Entering it locks the circuit overlay
  (no move, no rotate — the handle hides) so map clicks are unambiguous;
  pan/zoom still work (Leaflet already tells a click from a drag). Leaving trace
  mode keeps the route on screen with its stats.
- **Route editing is add / undo / clear only.** "Undo point" removes the last
  vertex; "Clear route" removes all. Dragging an existing vertex to nudge it is
  **not** in this phase (noted as a future refinement).
- **The route lives in `AppState`.** `AppState` gains `route: LonLat[]` (the
  clicked vertices, `[lon, lat]`, in order). New pure reducers `addRoutePoint`,
  `undoRoutePoint`, `clearRoute`. `selectCircuit` resets the route to `[]` (a
  route belongs to one circuit placement); `loadPlacement` sets it from the
  saved value. Trace-mode and study-view flags are **UI state** in `app/map.ts`,
  not `AppState`.
- **Route stats (pure, recomputed on route change — not per frame):**
  1. **Length** — `pathLength` of the route projected into the Porto metric
     frame, open polyline, in km/m.
  2. **Deviation** — resample the route and the *placed* centreline ring at
     `DEV_SAMPLE_M = 10` m; for every route sample take the nearest distance to
     the centreline ring, and for every ring sample the nearest distance to the
     route; report the **mean over all those samples** and the **max** (a
     Hausdorff-style symmetric figure, so a route that only covers half the
     shape still shows a large deviation). No alignment step — the route is
     drawn directly over the overlay, so both are already in the same place.
  The panel shows the route length beside the circuit length at the current
  scale with the signed % difference, and "deviation: ~NN m avg · NN m max".
- **Study view is a UI-stripping toggle.** When on: the controls panel collapses
  to a minimal block (route length, deviation, and an **Exit study view**
  button); the rotate handle, the circuit overlay (drag target + colour
  buckets), and the street layer are hidden; only the route polyline and the map
  remain. No layout change beyond hiding things; browser print still works.
- **Persistence: `SavedPlacement` gains an optional `route`, schema version → 2.**
  `PLACEMENTS_SCHEMA_VERSION = 2`. A stored record with `schemaVersion: 1` is
  still accepted and upgraded in memory to `{ …, schemaVersion: 2 }` with no
  route. `route`, when present, is an array of ≥ 2 `[lon, lat]` pairs in range;
  an empty route is stored as an omitted field. **Save** writes the current
  route, **Revert** and **auto-restore** load it, **Delete** drops it with the
  rest of the entry. `hasUnsavedChanges` compares the route too.
- **Rendering.** One `L.polyline` for the route (`ROUTE_COLOR = '#1565c0'`,
  weight 4). In trace mode, a small `L.circleMarker` on each vertex. The route
  layer sits above the circuit buckets. Recompute is *not* on the rAF overlay
  path — the route only changes on click / undo / clear / load, so those
  handlers call `render()` + `renderPanel()` directly.
- **Tests:** `app/trace.ts` (length, deviation, the < 2-point guard) is pure
  with full unit coverage plus a `fast-check` check that deviation is 0 for a
  route laid exactly on the centreline and grows with a uniform offset. The
  `placements` v2 upgrade + `route` validation, and the new `state` reducers,
  get unit tests. The map jsdom smoke test is extended: enter trace mode →
  simulate two map clicks → route polyline has the points and a length shows →
  save → the stored record carries the route → study view hides the circuit
  layers.

## Repository layout after this phase

```text
src/
├── placements.ts               # + route field, v2 + tolerant v1 upgrade, routesEqual, savedRoute()
├── placements.test.ts          # extended
├── app/
│   ├── trace.ts                # NEW pure: routeLengthM, routeDeviation, routeStats
│   ├── trace.test.ts           # NEW
│   ├── state.ts                # + route in AppState; addRoutePoint / undoRoutePoint / clearRoute;
│   │                           #   loadPlacement(+route); selectCircuit clears route
│   ├── state.test.ts           # extended
│   ├── storage.ts              # unchanged
│   ├── map.ts                  # trace mode, route layer, study view; save/revert/delete carry the route
│   └── map.test.ts             # extended
└── ui/
    ├── controls.ts             # + "Route" section: Trace toggle, Undo / Clear, stats, Study view
    └── controls.test.ts        # extended
```

`circuits.ts`, `streets.ts`, `porto.ts`, `geometry/`, `app/overlay.ts`,
`app/rotate.ts`, `app/proximity.ts` are unchanged. No new data files, no new
dependency.

## Data schema

### `SavedPlacement` (stored and in memory) — version 2

```ts
export type SavedPlacement = {
  schemaVersion: 2
  circuitId: string
  anchor: readonly [number, number]     // [lon, lat]
  rotationRad: number
  scale: number
  route?: readonly (readonly [number, number])[]   // ≥ 2 [lon, lat] vertices; omitted when empty
  savedAt: string                       // ISO 8601 UTC
}
```

`localStorage["circuit-finder/placements"]` stays a JSON object
`{ [circuitId]: SavedPlacement }`, written whole on every change.

### Validation rules (`validatePlacement`) — additions

- `schemaVersion` is `1` **or** `2`; the returned object is always normalised to
  `schemaVersion: 2`.
- if `route` is present: an array; either empty (normalised to *absent*) or
  ≥ 2 entries, each `[lon, lat]` finite with `lon ∈ [-180, 180]`,
  `lat ∈ [-90, 90]`.
- everything else unchanged from Phase 4.

## New / changed code

### `app/trace.ts` (pure)

```ts
export const DEV_SAMPLE_M = 10

export type RouteStats = {
  /** Route length, metres (open polyline). */
  lengthM: number
  /** Mean of all symmetric nearest-distance samples, metres. */
  meanDeviationM: number
  /** Largest nearest-distance sample, metres (Hausdorff-style). */
  maxDeviationM: number
}

/** Length of the route (open polyline) in the Porto metric frame. */
export function routeLengthM(metricRoute: readonly Point[]): number

/**
 * Symmetric deviation between the traced route (open) and the placed centreline
 * ring (closed), both in Porto-frame metres. Resamples each at `sampleM`,
 * measures every sample's nearest distance to the other polyline, returns the
 * mean over all samples and the max.
 */
export function routeDeviation(
  metricRoute: readonly Point[],
  metricRing: readonly Point[],
  opts?: { sampleM?: number },
): { meanM: number; maxM: number }

/**
 * Combined stats. Returns `null` when the route has fewer than 2 points (nothing
 * meaningful to measure).
 */
export function routeStats(
  metricRoute: readonly Point[],
  metricRing: readonly Point[],
): RouteStats | null
```

Deviation uses `resample` (`geometry/path`) and `distanceToSegment`
(`geometry/nearest`), scanning the other polyline's segments directly
(brute force — a few hundred samples against a few hundred segments, once per
route edit, is trivial; no index needed).

### `placements.ts` — additions

- `PLACEMENTS_SCHEMA_VERSION = 2`.
- `validatePlacement` per the rules above (accepts v1, normalises to v2,
  validates `route`).
- `makeSavedPlacement(circuitId, placement, route: readonly LonLat[], now): SavedPlacement`
  — `route` shorter than 2 points is stored as omitted.
- `savedRoute(s: SavedPlacement): LonLat[]` — `s.route` as a fresh array, `[]`
  when absent.
- `routesEqual(a: readonly LonLat[], b: readonly LonLat[]): boolean` — same
  length, exact component compare.
- `parseStoredPlacements` unchanged in shape; it now round-trips the `route`
  field through `validatePlacement`.

### `app/state.ts` — additions

- `AppState` gains `route: LonLat[]`; `initialState` sets `route: []`.
- `addRoutePoint(state, p: LonLat): AppState` — append.
- `undoRoutePoint(state): AppState` — drop the last vertex (no-op on `[]`).
- `clearRoute(state): AppState` — `route: []`.
- `selectCircuit` also resets `route: []`.
- `loadPlacement(state, circuits, circuitId, placement, route: readonly LonLat[]): AppState`
  — sets `route` (copied) alongside circuit + placement.
- `moveTo` / `rotateTo` / `setScale` leave the route untouched (the user may
  nudge the overlay after tracing; the route stays put and the deviation figure
  updates).

### `ui/controls.ts` — additions

`ControlsView` gains:

- `tracing: boolean`, `studyView: boolean`;
- `routePointCount: number`;
- `routeStats: RouteStats | null` and `circuitLengthM: number` (for the
  side-by-side length + % line).

`renderControls`:

- when `studyView` is true, render **only** the minimal block:
  `data-role="study-summary"` with the route length, the deviation line, and a
  `data-role="study-exit"` button — nothing else.
- otherwise, below the "Saved placement" section, a **"Route"** section:
  - `data-role="trace"` button — "Trace route" when off, "Stop tracing" when on;
  - while `tracing`: `data-role="undo-point"` and `data-role="clear-route"`
    buttons (disabled at 0 points) and a "N points" count;
  - when `routeStats` is non-null: a `dl` with `data-role="route-length"`
    ("1.98 km — circuit 2.31 km, −14%") and `data-role="route-deviation"`
    ("~45 m avg · 160 m max");
  - `data-role="study"` button — "Study view" (only when `routeStats` is
    non-null, i.e. there is something to study).

`ControlsHandlers` gains `onToggleTrace()`, `onUndoRoutePoint()`,
`onClearRoute()`, `onToggleStudyView()`. Still pure render-to-string + explicit
`bind` returning a disposer.

### `app/map.ts` — glue

- State: `let tracing = false`, `let studyView = false`.
- Layers: `routeLine = L.polyline([], { color: ROUTE_COLOR, weight: 4 })`; a
  `L.LayerGroup` of vertex `circleMarker`s, populated only while `tracing`.
- `map.on('click', e => { if (!tracing) return; state = addRoutePoint(state,
  [e.latlng.lng, e.latlng.lat]); render(); renderPanel() })`.
- `render()` additionally: `routeLine.setLatLngs(state.route.map(toLatLng))`;
  rebuild the vertex markers when `tracing`; compute
  `routeStats(project route, project centreline ring)` and hand it to the panel.
- Trace mode: `onOverlayDown` early-returns while `tracing`; the rotate handle is
  hidden and its dragging disabled (same treatment as Phase 4 preview);
  entering trace mode turns `previewingSaved` off.
- Study view: `onToggleStudyView` flips `studyView`, forces `tracing = false`,
  toggles `container.classList` (`study`), adds/removes the street layer, the
  drag target, the colour buckets and the handle from the map, and
  re-renders the panel (which now renders the minimal block). Exit restores
  them.
- `onToggleTrace`: flip `tracing`; when turning off, also clear the vertex
  markers; re-render.
- `onUndoRoutePoint` / `onClearRoute`: the matching reducer, then `render()` +
  `renderPanel()`.
- Save: `makeSavedPlacement(state.circuitId, state.placement, state.route, new Date())`.
- Revert / auto-restore on init / circuit pick: `loadPlacement(…, savedRoute(saved))`;
  a circuit with no saved entry gets `route: []` via `selectCircuit`.
- `hasUnsavedChanges`: `!saved || !placementsEqual(...) || !routesEqual(state.route, savedRoute(saved))`.
- `destroy()` removes the new layers.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `DEV_SAMPLE_M` | `10` | resample spacing for the deviation figure (`app/trace.ts`) |
| `ROUTE_COLOR` | `'#1565c0'` | traced-route polyline colour (`app/map.ts`) |
| `PLACEMENTS_SCHEMA_VERSION` | `2` | stored schema version (`src/placements.ts`) |

`MIN_SCALE` / `MAX_SCALE` reused from `app/state.ts`.

## Tests

All offline. Pure modules in the default vitest environment; `storage.test.ts`
and `map.test.ts` keep `// @vitest-environment jsdom`.

- **`trace`**:
  - `routeLengthM` of a 3-4-5 triangle path equals the summed segment lengths;
  - a route sampled exactly on a straight test centreline → `meanDeviationM` and
    `maxDeviationM` ≈ 0;
  - the same route shifted a constant `d` metres sideways → both ≈ `d`
    (`fast-check`, a few `d` values, tolerance for sampling);
  - a route that covers only half the ring → `maxDeviationM` is large even
    though every route sample is close (the ring→route direction catches it);
  - `routeStats` returns `null` for `[]` and for a single point.
- **`placements`**:
  - a stored `schemaVersion: 1` record validates and comes back as
    `schemaVersion: 2` with no `route`;
  - a v2 record with a valid `route` round-trips; `route` with one point, a
    non-pair entry, or an out-of-range coord is rejected; an empty `route`
    normalises to absent;
  - `makeSavedPlacement` with a < 2-point route omits the field; with ≥ 2 keeps
    it; `savedRoute` returns `[]` when absent and a copy otherwise;
  - `routesEqual` true for equal, false for different length or a moved vertex.
- **`state`**: `addRoutePoint` / `undoRoutePoint` / `clearRoute` are pure and
  immutable; `undoRoutePoint` on `[]` is a no-op; `selectCircuit` clears the
  route; `loadPlacement` sets circuit + placement + route (copied);
  `moveTo`/`rotateTo`/`setScale` keep the route.
- **`controls`**: the "Route" section shows the Trace button (label follows
  `tracing`); Undo/Clear appear and disable correctly while tracing; the stats
  `dl` and the Study button appear only with a non-null `routeStats`; in
  `studyView` only `data-role="study-summary"` + `data-role="study-exit"` render
  and the circuit picker is absent; `bind` fires each handler.
- **`map` (jsdom)**: after `createMapApp`, clicking `data-role="trace"` then
  dispatching two `map` `click` events adds a 2-point route polyline and the
  panel shows a route length; clicking `data-role="save"` writes a stored record
  whose JSON contains a `route` array of length 2; toggling `data-role="study"`
  removes the street layer / colour buckets from the container and the panel
  shows only the study summary; `destroy()` tears down cleanly.

## Acceptance criteria

- `npm run dev`: with a circuit placed, the user clicks **Trace route**, clicks
  along streets under the overlay, and sees a blue route line build up. **Undo
  point** and **Clear route** work. The overlay cannot be moved or rotated while
  tracing.
- The panel shows the traced route's real length next to the circuit's length at
  the current scale (with the % difference) and a "deviation: ~NN m avg · NN m
  max" figure; both update when the route changes and when the overlay is moved,
  rotated, or rescaled. There is no single "match %".
- **Study view** hides the panel controls, the rotate handle, the circuit
  overlay and the street layer, leaving the map, the route, and a small summary
  with an **Exit study view** button; browser print produces a usable page.
- Saving the placement also saves the route; reloading the page (or picking the
  circuit again) brings the route back with the placement; **Revert to saved**
  and **Delete saved** include the route. A `schemaVersion: 1` record saved by
  Phase 4 still loads.
- No network request; no new runtime dependency. `localStorage` unavailable
  still degrades to a working, non-persistent session.
- `npm run test:run` and `npm run build` pass.
- `docs/ROADMAP.md` (Phase 5 → `done`, dated decision-log entry, priority →
  Phase 6+ triage) and `RELEASES.md` updated per the working method.

## Not in scope

- Snapping the route to the street network, or any auto-routing between clicks
  (**ROADMAP Phase 6+**).
- Dragging an existing route vertex to adjust it; inserting a vertex mid-route.
- A single shape-match percentage or a turning-function / Procrustes score
  (**ROADMAP Phase 6+**, for the auto-matching work).
- A rendered-image (PNG) export or a dedicated `@media print` stylesheet.
- GPX or any file export of the route (**ROADMAP Phase 6+**).
- More than one route per placement.
- Elevation, surface, or time/pace estimates for the route.
- Editing a saved route without loading its placement first.
