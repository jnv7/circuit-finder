# Spec — Phase 2: Map + acetate overlay

Status: `done` (shipped 2026-09-10)
Depends on: [phase-1-geometry.md](phase-1-geometry.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

The first interactive release. Put a real map of Porto on screen, drop a chosen
circuit's centreline onto it at true 1:1 scale, and let the user slide and
rotate it by hand — the acetate move from the vision, on a web map. A live
readout shows the lap length and longest straight for the current scale.

No street-proximity feedback yet (Phase 3), no saving yet (Phase 4), and no
route tracing yet (Phase 5). When this phase ships, the user can *find* a
placement by eye but not *keep* it.

## Decisions locked for this phase

- **Map:** Leaflet (from npm) with OpenStreetMap raster tiles, standard
  attribution, no API key. Initial view is fixed on Porto and the user cannot
  change the base area yet (panning/zooming the map itself is fine; "free the
  map" is a Phase 6+ item).
- **Initial view:** centre `41.1579, -8.6291`, zoom `14`. Tune during
  implementation; keep it a single named constant.
- **Overlay geometry:** reuse `MetricCircuit.metricCentreline` (metres, centroid
  at origin) unchanged. Placement is `{ anchor, rotationRad, scale }`; the
  on-map polyline is `metricCentreline` scaled, rotated, then projected back to
  lon/lat around `anchor` with the **inverse** of the Phase 1 equirectangular
  projection. Re-projecting circuit-centroid metres around a Porto anchor adds
  well under 0.5% distortion at this size — acceptable, same basis as Phase 1.
- **Scale:** real 1:1 by default. An optional multiplier (a numeric input,
  range 0.5–3.0, step 0.05) is the only way to change scale in this phase —
  there is no scale drag handle.
- **Transform:** move + rotate only. No mirror. (Decision log, 2026-09-08.)
- **Interaction model:** drag anywhere on the overlay to move it; one visible
  handle to rotate. Both implemented directly with Leaflet pointer events — no
  drag/rotate plugin, to keep the dependency list to just Leaflet.
- **Rotation math runs in the map's pixel space** (`map.latLngToContainerPoint`)
  for the drag itself; the stored `rotationRad` is the geographic bearing that
  reproduces it. Document the sign convention next to the code.
- **State lives in one module-level object** and a re-render is a pure
  recompute of the overlay lat/lngs plus a Leaflet layer swap. No framework, no
  reactive library.
- **Tests:** the geometry of placement, rotation-from-pointer, and the readout
  are pure functions with full unit coverage. The Leaflet glue (map creation,
  layer updates, event wiring) is thin and covered by one jsdom mount smoke
  test only.

## Repository layout after this phase

```text
src/
├── main.ts               # mounts the map app instead of the text list
├── app/
│   ├── state.ts          # Placement, AppState, reducers (pure)
│   ├── state.test.ts
│   ├── overlay.ts        # placement math: metric centreline -> lat/lng, readout (pure)
│   ├── overlay.test.ts
│   ├── rotate.ts         # bearing from a pointer drag, handle position (pure)
│   ├── rotate.test.ts
│   ├── map.ts            # Leaflet setup + render loop + event wiring (glue)
│   └── map.test.ts       # jsdom: mounts without throwing, renders a polyline
├── geo.ts                # + placePoints(points, anchor) convenience
└── ui/
    ├── controls.ts       # circuit picker, scale input, readout panel (DOM strings + wiring)
    └── controls.test.ts
index.html                # full-viewport #app
```

`circuits.ts` and `src/geometry/` are unchanged except for any small helper the
placement math needs.

## New / changed code

### `geo.ts`

- `placePoints(points: readonly Point[], anchor: LonLat): LonLat[]` — inverse
  projection of local metres to geographic coordinates around `anchor`. Thin
  wrapper over `localProjection(anchor).toLonLat`.

### `app/overlay.ts` (pure)

- `type Placement = { anchor: LonLat; rotationRad: number; scale: number }`
- `overlayLatLngs(circuit: MetricCircuit, placement: Placement): LonLat[]` —
  apply scale, then rotation, then `placePoints`. Returns a closed ring's worth
  of points (caller appends the first point to close the Leaflet polyline).
- `readout(circuit: MetricCircuit, scale: number): { lapM: number; straightM: number }`
  — `lengthM * scale` and `longestStraight.lengthM * scale`.
- `formatDistance(m: number): string` — `"1.85 km"` at ≥ 1 km, `"940 m"` below.

### `app/rotate.ts` (pure)

- `bearingFromDrag(centerPx, pointerPx): number` — `atan2` in pixel space.
- `handlePosition(centerLatLng, rotationRad, pixelRadius, project): LatLng` —
  where to draw the rotate handle (a fixed pixel distance from the anchor).
- Round-trip property: `bearingFromDrag(center, handlePixel(center, θ)) ≈ θ`.

### `app/state.ts` (pure)

- `type AppState = { circuitId: string; placement: Placement }`
- `initialState(circuits, mapCenter): AppState` — first circuit, anchor at the
  map centre, `rotationRad = 0`, `scale = 1`.
- Reducers: `selectCircuit`, `moveTo(anchor)`, `rotateTo(rad)`, `setScale(s)` —
  each returns a new `AppState`; `setScale` clamps to [0.5, 3].

### `app/map.ts` (glue)

- `createMapApp(container, circuits): { destroy(): void }`.
- Builds the Leaflet map, OSM `L.tileLayer` with attribution, fixed initial
  view.
- Holds the current `AppState`; on any change recomputes `overlayLatLngs` and
  replaces two polylines:
  - a visible thin line (~3 px, semi-transparent) — the centreline;
  - an invisible fat line (~20 px, `opacity: 0`) underneath for an easy drag
    target.
- Wires: `mousedown`/`touchstart` on the overlay → move; drag on the rotate
  handle (an `L.marker` with a `divIcon`) → `rotateTo`; the controls panel →
  `selectCircuit` / `setScale`.
- Circuit-geometry attribution (OSM/ODbL, from `circuit.attribution`) shown in
  the Leaflet attribution control alongside the tile attribution.

### `ui/controls.ts`

- Renders a small panel: a `<select>` of circuit names, a scale
  `<input type="number">`, and the readout (lap + longest straight, live).
- Pure render-to-string plus an explicit `bind(root, handlers)` for events, so
  the string output is testable without a DOM.

## Tests

All offline. `vitest` stays in its default environment for the pure modules; the
one jsdom test opts in with a `// @vitest-environment jsdom` comment.

- **`overlay`**: a placement with `scale 1, rotation 0` at an anchor puts the
  centreline's centroid at that anchor (within a metre); `scale s` multiplies
  the on-map lap length by `s`; `rotation θ` rotates every point about the
  anchor by θ (check bearings); `readout` matches `lengthM * scale`;
  `formatDistance` boundaries.
- **`rotate`**: `bearingFromDrag` sign convention; handle/bearing round-trip
  property (`fast-check`).
- **`state`**: reducers are pure and immutable; `setScale` clamps; selecting an
  unknown id throws.
- **`controls`**: rendered HTML has one option per circuit and shows the
  formatted readout; `bind` calls the right handler on change.
- **`map` (jsdom)**: `createMapApp` on a detached `<div>` creates a
  `.leaflet-container`, renders a centreline polyline for the default circuit,
  and `destroy()` removes listeners without throwing.

## Acceptance criteria

- `npm run dev` shows a Porto map with a circuit overlay at 1:1; the user can
  drag it to a new location and rotate it with the handle.
- Changing the circuit or the scale multiplier updates the overlay and the
  readout live; rotating/moving does not change the readout.
- Lengths are shown in km/m and match `officialLengthM × scale` to within the
  Phase 1 tolerance.
- Both attributions (map tiles, circuit geometry) are visible on the map.
- `npm run test:run` and `npm run build` pass. Leaflet is the only new runtime
  dependency.
- `docs/ROADMAP.md` and `RELEASES.md` updated per the working method.

## Not in scope

- Street-proximity colouring / any use of street data (Phase 3).
- Saving, restoring, exporting, or URL state (Phase 4).
- Route tracing or deviation measurement (Phase 5).
- Changing the map's area, place search, or pan-to-anywhere (Phase 6+).
- A scale-by-drag handle or a scale-by-target-distance control (Phase 6+).
- Mirrored placements.
- Snapping the overlay to streets or any street-network data.
- Elevation.
