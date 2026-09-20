# Spec — Phase 23: Routes page (look up generated routes, download GPX)

Status: `todo`
Depends on: [phase-22-route-generator.md](phase-22-route-generator.md) (the data),
[phase-18-gpx-export.md](phase-18-gpx-export.md) (`app/gpx.ts`),
[phase-2-map-overlay.md](phase-2-map-overlay.md) (Leaflet setup, tiles, attribution)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

A **second, separate page** where the stored routes from Phase 22 are simply
looked up: pick a circuit, see the route drawn on a real map with the
circuit's outline over it, read plainly how well the route follows the
circuit, and **download it as a GPX file** to load into whatever running or
navigation app gives the turn-by-turn instructions. Nothing on this page is
computed — it reads committed JSON.

Two reasons it is a new page and not a mode of the existing one:

- The existing page is a **tool** (drag a circuit around, ask for
  suggestions, build and adjust a skeleton). This page is a **lookup**: no
  state to edit, nothing to wait for.
- The two use different ideas of "match" (the existing page fits the
  *outline* to streets; this one shows a *route* generated to follow the
  outline). Keeping them apart avoids one page carrying two algorithms'
  vocabulary, and leaves the old page untouched while the new approach earns
  trust.

## How it stays true to the vision

- **"The primary output is a clear map view to study and memorise the
  route."** The page is exactly that, and nothing else.
- **"Save an attempt... export/import it as a file"** — the GPX download is
  the "take it with you" half (Phase 18's rationale). VISION's non-goal
  "GPX export as a priority" was already revisited by Phase 18; on
  2026-09-20 the user asked for the download explicitly, and VISION is
  updated to match.
- **Static and free.** A second Vite entry point, built into the same static
  `dist/`, deployed to the same GitHub Pages site. No backend; route files
  are bundled as lazily loaded chunks.
- **Turn-by-turn navigation is still a non-goal** — the page provides the
  *path*; a receiving app provides the step-by-step.

## Decisions locked for this phase

- **New entry `routes.html` → `src/routesMain.ts`**, alongside `index.html`.
  `vite.config.ts` gets `build.rollupOptions.input` listing both. URL:
  `…/circuit-finder/routes.html` (dev: `/routes.html`). The two pages link to
  each other with one plain anchor each; the existing page's only change is
  that one link.
- **Data loading:** `import.meta.glob('./data/routes/*.json')` (lazy). The
  page needs `circuits.json` (already bundled) for names and the outline.
  A circuit with no route file is listed as "no route generated yet" and is
  not selectable — the list is the whole calendar, the availability is
  visible.
- **Map:** Leaflet with the same OSM tile layer and attribution as the
  existing page (reuse its setup, do not duplicate constants), fitted to the
  route's bounds. The **basemap is what tells the user where the route is** —
  the first version of these results was shown as street lines on white and
  the immediate reaction was "I don't know where this is".
- **Layers:** the route solid, the circuit outline dashed and toggleable
  (checkbox, on by default), a start marker at the first point. The outline
  is `circuits.json`'s centreline placed with the route's `pose` and the
  file's `scale` (`geo.ts`'s `placePoints`) — it is never stored, so it
  cannot drift from the circuit data.
- **Location context beyond the map:** the route's optional `area` text (set
  at generation time), the start coordinates, and a plain link "Open in
  OpenStreetMap" (`https://www.openstreetmap.org/?mlat=…&mlon=…#map=16/…/…`).
  No geocoding service is called at runtime.
- **Routes per circuit:** the (up to three) stored routes are selectable;
  each carries a badge — "Meets the bar" or, when it does not, **which terms
  miss and by how much** ("mean 33 m, limit 30 m · longest deviation 128 m,
  limit 100 m"). A pure `barMisses(metrics, bar)` produces the wording so it
  is unit-testable. Nothing is hidden for failing.
- **Plain-language metrics**, not jargon: "Length 4.93 km (1.13× the
  circuit)", "Strays from the circuit by 22 m on average, 76 m at most",
  "Retraces 2 % of its length". Fréchet is shown as a smaller "shape
  distance" line; it is the order-aware figure and is useful, but is not
  the headline.
- **Bookmarkable state in the URL hash**, `#hungaroring/2` (circuit id and
  route rank) — static-site friendly, shareable, restores on load. Pure
  `parseHash` / `formatHash`. No `localStorage`: there is nothing to persist.
- **GPX download** via Phase 18's pure `buildGpx` (a `<trk>` with one
  `<trkseg>`, no elevation, no timestamps). The loop is **closed** for the
  file by appending the first point (stored routes do not repeat it). Track
  name `"<Circuit name> — route <rank>"`; filename
  `<circuitId>-route-<rank>.gpx` (a second pure helper in `app/gpx.ts`,
  since the route is stored data, not "today's live route"). Same
  `Blob` + synthetic `<a download>` mechanism as Phase 18.
- **Deploy pipeline:** the Phase 17 post-deploy smoke check is extended to
  fetch `routes.html` too, with the same two assertions (no `/src/`
  reference, a `/circuit-finder/assets/*.js` reference). A second entry
  point is exactly the kind of change that can silently ship raw source.

## Repository layout after this phase

```text
routes.html                      # new: second entry
vite.config.ts                   # + rollupOptions.input for both pages
.github/workflows/deploy.yml     # smoke check also covers routes.html
src/
├── routesMain.ts                # new: bootstraps the page
├── app/
│   ├── routesPage.ts            # new: the page (render + wiring)
│   ├── routesPage.test.ts       # new (jsdom)
│   ├── routesHash.ts            # new: parseHash / formatHash (pure)
│   ├── routesHash.test.ts       # new
│   ├── barMisses.ts             # new: plain wording for a route's misses (pure)
│   ├── barMisses.test.ts        # new
│   ├── gpx.ts                   # Phase 18's module; + routeGpxFilename
│   └── gpx.test.ts              # extended
└── main.ts                      # + one link to routes.html
```

If Phase 18 has not landed when this is implemented, create `app/gpx.ts`
exactly as Phase 18's spec defines it; Phase 18 then only adds its button.

## New / changed code

```ts
// app/routesHash.ts
export type RouteRef = { circuitId: string; rank: number }
export function parseHash(hash: string): RouteRef | null   // "#hungaroring/2"
export function formatHash(ref: RouteRef): string

// app/barMisses.ts
export function barMisses(m: RouteMetrics, bar: Bar): string[]  // [] when the bar is met

// app/gpx.ts (added to Phase 18's module)
export function routeGpxFilename(circuitId: string, rank: number): string
```

`RouteFile` / `RouteMetrics` / `Bar` come from Phase 22's `src/routes.ts`.

## Tests

- **`routesHash.test.ts`**: round-trips; rejects garbage, missing or
  non-integer rank, empty id; an unknown circuit is handled by the page, not
  the parser.
- **`barMisses.test.ts`**: a route inside the bar → `[]`; each term missing
  alone produces exactly its own sentence with the real figure and the
  limit; several missing terms → several sentences, stable order.
- **`gpx.test.ts`** (extended): a stored open ring exported as a closed loop
  has `n + 1` `<trkpt>`, the last equal to the first; `routeGpxFilename`
  → `hungaroring-route-2.gpx`.
- **`routesPage.test.ts`** (jsdom, Leaflet as in `app/map.test.ts`, route
  data injected, no real route files needed): lists every circuit and
  disables those without a file; selecting one renders route buttons, the
  badge, the plain-language metrics and the map layers (route polyline,
  dashed outline, start marker); the outline checkbox toggles the layer; a
  route that misses the bar shows the wording from `barMisses`; loading with
  `#silverstone/2` selects that route; an unknown circuit or rank in the hash
  falls back to the first available route instead of breaking; the GPX
  button creates a `Blob` of type `application/gpx+xml` and clicks an anchor
  (stubbed `URL.createObjectURL`, as in Phase 18's test).
- **A real-data check**, cheap and offline: every committed
  `src/data/routes/*.json` renders through the page code without throwing
  (Phase 22's `routes.test.ts` already validates the files).

## Acceptance criteria

- `npm run build` and `npm run test:run` pass; `dist/` contains both
  `index.html` and `routes.html`, and the built `routes.html` references its
  bundled script.
- `npm run dev`, `/routes.html`: choose Hungaroring → the route appears on the
  OSM basemap with its dashed outline; the location is obvious from the map
  and the `area` text; the metrics read plainly; **Download GPX** saves a
  file.
- **The GPX is checked in the receiving app the user actually uses**
  (import, confirm the path, confirm what kind of guidance the app gives
  along it) and the result is recorded in the decision log. This is the one
  acceptance step that cannot be automated.
- The deploy smoke check passes for both pages after the next push to `main`.
- The existing page still works unchanged apart from its new link.
- `docs/ROADMAP.md` updated per the working method, and a **user-facing
  `RELEASES.md` entry** — this is the phase that makes the routes visible.

## Not in scope

- **Generating or editing anything on this page.** No dragging, no
  regenerating, no tuning; changes go through Phase 22's generator.
- **Comparing routes side by side**, favourites, notes, or saving the user's
  choice — nothing to persist yet.
- **Turn-by-turn instructions or cue sheets in the page.** The receiving app
  does that.
- **Elevation and timestamps in the GPX** (VISION non-goal; Phase 18's
  decision).
- **Retiring the existing page**, or its Phase 6–15 suggestion flow and
  Phase 14 skeleton. A separate decision, taken after this page has been used.

## Open questions

- **Which receiving app, and does a `<trk>` give it step-by-step guidance?**
  Phase 18 chose `<trk>` (the broadly compatible "path to follow"). Some
  apps only announce turns along an imported *route* (`<rte>`), or compute
  their own guidance from a track. If the user's app needs `<rte>`, add a
  second button rather than changing the first. Decided by the acceptance
  check above, with the user's actual app.
- **Should the page also offer the reverse direction?** A loop is runnable
  either way; the circuit's own direction is the stored one. Cheap to add
  (reverse `points`) if wanted.
