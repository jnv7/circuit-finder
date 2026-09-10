# Roadmap

Living document: phases, current priority, decisions, open questions, and future
ideas. See [VISION.md](VISION.md) for the product goal and
[../CONVENTIONS.md](../CONVENTIONS.md) for engineering rules.

## Current priority

**Phase 3 — Street proximity feedback.** Spec:
[specs/phase-3-street-proximity.md](specs/phase-3-street-proximity.md). Not
started.

## Phases

Status: `todo` / `in progress` / `done`.

### Phase 0 — Skeleton + CI — `done`

Spec: [specs/phase-0-skeleton.md](specs/phase-0-skeleton.md).

- Repo layout, `CONVENTIONS.md`, `CLAUDE.md`.
- Vite + TypeScript + Vitest set up, 9 passing tests.
- CI: test + build on push, deploy to Pages from `main` (originally
  `.gitlab-ci.yml`; moved to GitHub Actions on 2026-09-10 — see the decision
  log).
- Minimal page that loads `circuits.json` and lists the circuits.

### Phase 1 — Circuit data + geometry toolkit — `done`

Spec: [specs/phase-1-geometry.md](specs/phase-1-geometry.md).

- `circuits.json` full schema (`officialLengthM`, `attribution`, `[lon, lat]`
  `centreline`) + loader validation, including a projected-length cross-check.
- Three circuits normalised from OSM as closed centrelines: `hungaroring`,
  `silverstone`, `catalunya`. Data provenance in `src/data/circuits.schema.md`.
- `src/geo.ts` (equirectangular projection) and `src/geometry/` toolkit:
  `vector`, `path` (`pathLength`, `resample`, `centroid`, `signedArea`,
  `bounds`, `recenter`), `transform` (similarity, no reflection), `straight`
  (`longestStraight`).
- 48 passing tests, including `fast-check` property tests for
  rotate/scale invariance.

### Phase 2 — Map + acetate overlay — `done`

Spec: [specs/phase-2-map-overlay.md](specs/phase-2-map-overlay.md).

- Leaflet map, fixed initial view on Porto.
- Pick a circuit; render its centreline as an overlay at real-world scale
  (1:1 default, optional multiplier).
- Drag to move, handle to rotate. No mirror.
- Live readout: lap length and longest straight, in km/m.

### Phase 3 — Street proximity feedback — `todo`

Spec: [specs/phase-3-street-proximity.md](specs/phase-3-street-proximity.md).

- Bundle a simplified Porto street network as a static asset (same pattern as
  `circuits.json`); no runtime Overpass.
- Spatial grid index built once on load; nearest-street distance per centreline
  point stays a pure, fast, offline computation.
- While the user moves/rotates the overlay, colour it on a green→amber→red
  ramp — ideally per segment — by how much of its length sits within ~10 m of a
  street. A hint, not a verdict; the user still judges the fit.
- No automatic placement or search (that stays Phase 6+).

### Phase 4 — Save / restore / export — `todo`

- Save an attempt `{ circuitId, center, rotation, scale, name, notes, createdAt }`
  to `localStorage`.
- List saved attempts; reload one onto the map.
- Export/import an attempt as a JSON file.
- Optionally load bundled example attempts from the repo.

### Phase 5 — Trace & study — `todo`

- Trace mode: click along real streets, following the overlay, to draw the route.
- Show traced route real length and deviation from the circuit shape.
- Clean, printable/screenshot-friendly view for memorising the route.

### Phase 6+ — Roadmap / not scheduled

- Free the map: any location, pan/zoom, place search.
- Editable circuit scale target by distance instead of 1:1.
- Automatic matching: given a drawn shape or a circuit, search the street network
  (reusing the Phase 3 street data, extended beyond Porto via Overpass) and
  suggest placements, scored by turning function + Procrustes distance.
- Snap a traced route to the street network.
- More circuits; auto-select the circuit for the current race weekend.
- GPX export.

## Decision log

Newest first. Each entry dated.

- **2026-09-10 — Deploy target: GitHub Pages.** The repo lives on GitHub
  (`github.com/jnv7/circuit-finder`), never GitLab. Replaced `.gitlab-ci.yml`
  with `.github/workflows/deploy.yml` (test + build on every push/PR;
  `upload-pages-artifact` + `deploy-pages` from `main`). Vite `base`
  (`/circuit-finder/`) already matched a project-page path, so no build change.
  Supersedes the 2026-09-08 "must deploy to GitLab Pages" note; everything else
  in that entry (static, no backend, `localStorage` + JSON) still holds. Needs a
  one-time repo setting: *Pages → Source: GitHub Actions*.
- **2026-09-10 — Phase 2 shipped.** First interactive release: a Leaflet map
  fixed on Porto (OSM raster tiles, no key), a chosen circuit's centreline
  overlaid at true 1:1, drag-anywhere to move and a single handle to rotate,
  plus a live lap-length / longest-straight readout and a 0.5–3.0 scale
  multiplier. Leaflet is the only new runtime dependency; drag and rotate are
  wired directly on Leaflet pointer events (no plugin). State is one
  module-level object; a re-render is a pure `overlayLatLngs` recompute plus a
  polyline swap. Placement math (`app/overlay.ts`), rotation-from-pointer
  (`app/rotate.ts`) and the reducers (`app/state.ts`) are pure with unit +
  `fast-check` coverage; the Leaflet glue has one jsdom mount smoke test.
  Rotation sign convention: `rotationRad` is CCW in the local ENU frame and CCW
  on screen, 0 = handle straight up. 70 tests pass.
- **2026-09-10 — New Phase 3: street proximity feedback.** While the user moves
  the overlay by hand, colour it by how much of its length sits near real
  streets — an advisory hint, keeping judgement with the user (does not violate
  the "no match score required" principle). Approach: bundle a simplified Porto
  street network as a static asset, index it in a spatial grid, compute
  nearest-street distance as pure local geometry. Slots before save/trace; old
  Phases 3/4/5+ become 4/5/6+.
- **2026-09-09 — Phase 1 shipped.** Circuit geometry source: **OpenStreetMap**
  raceway ways (ODbL 1.0, per-circuit attribution stored in `circuits.json`; a
  normalised copy lives in the repo, no runtime fetch). Bundled circuits:
  `hungaroring`, `silverstone`, `catalunya` — all cleanly mapped as connected
  `highway=raceway`. **Monaco dropped** (street circuit; OSM mixes raceway and
  street ways with split carriageways — not cleanly stitchable this phase);
  Hungaroring took its slot. Monaco + Madrid stay roadmap candidates. Geometry
  runs in a local ENU metric frame via an equirectangular projection about each
  circuit's centroid. Toolkit: `src/geo.ts` + `src/geometry/` (vector, path,
  similarity transform without reflection, longest-straight). Added `fast-check`
  (dev-only) for property tests. 48 tests pass; computed lap lengths land within
  0.6% of published figures.
- **2026-09-09 — Phase 0 shipped.** Plain TypeScript modules + Vite (no
  framework). Deploy target: GitLab Pages **project site**, Vite `base` =
  `/circuit-finder/`. Toolchain landed on `node@24`, `typescript@7`, `vite@8`,
  `vitest@5` (0 audit vulnerabilities). Node was installed from the official
  prebuilt tarball to `~/.local/node` (Homebrew tried to build cmake from
  source). Circuit data is a typed JSON import for now; `fetch` + full schema
  come in Phase 1.
- **2026-09-08 — Project docs structure.** `docs/VISION.md` (stable goal),
  `docs/ROADMAP.md` (living), `CONVENTIONS.md` (rules), `docs/specs/` (one spec
  per phase, written when it becomes the priority).
- **2026-09-08 — Static site, no backend.** Must deploy to GitLab Pages.
  TypeScript + Vite + Leaflet + Vitest. Persistence via `localStorage` + JSON
  export/import. No Python, no server, no paid services.
- **2026-09-08 — Manual "acetate" workflow is the MVP.** Automated shape matching
  is deferred to Phase 6+. The user judges the fit by eye.
- **2026-09-08 — Real 1:1 scale by default**, with an optional multiplier.
  Satisfies "a 2 km circuit straight is a ~2 km route segment".
- **2026-09-08 — Transform: move + rotate only.** No reflection/mirror.
  Only overall shape matters; start/finish line position does not.
- **2026-09-08 — Fixed context for the MVP.** Map fixed on Porto; circuit list
  fixed and bundled. Freeing the map is a roadmap item.
- **2026-09-08 — No elevation** anywhere in the current design.
- **2026-09-08 — Map: Leaflet + OpenStreetMap raster tiles**, with attribution,
  no API key.

## Open questions

- OSM tile usage policy for a low-volume hobby deployment — confirm acceptable
  (relevant from Phase 2).
- Add Monaco and Madrid once their OSM geometry can be stitched into a clean
  centreline (Monaco needs manual assembly; Madrid needs OSM coverage of the
  IFEMA layout).

Resolved:

- ~~Circuit geometry source: OSM raceway ways vs. a public F1 GeoJSON dataset~~ →
  OpenStreetMap raceway ways, normalised copy in the repo (2026-09-09).
- ~~Which circuits to bundle first~~ → `hungaroring`, `silverstone`, `catalunya`
  (2026-09-09).

- ~~Frontend: plain TypeScript vs. a small framework~~ → plain TypeScript + Vite
  (2026-09-09).
