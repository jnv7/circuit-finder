# Spec — Phase 4: Save & restore a placement

Status: `done` (2026-09-10)
Depends on: [phase-2-map-overlay.md](phase-2-map-overlay.md),
[phase-3-street-proximity.md](phase-3-street-proximity.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phases 2–3 let the user find a placement by eye and see how street-aligned it
is. This phase lets the user **keep** the one they found. Save the current
placement for the current circuit, and have it come back automatically the next
time that circuit is opened.

From the vision: *"Save an attempt and reopen it later."* No accounts, no
backend — `localStorage` only, the persistence model locked on 2026-09-08.

When this phase ships, the user can find a placement (Phase 2), judge it
(Phase 3), and now **return to it later** without re-doing the work. Route
tracing is still Phase 5.

## Scope decision (2026-09-10)

The original Phase 4 spec had a named library of attempts (a list, rename,
notes, examples) plus file export/import. That was cut down: for the manual
"acetate" MVP the user is looking for *the* loop for a given circuit, not
collecting candidates. This phase is therefore:

- **one saved placement per circuit**, keyed by `circuitId`;
- **auto-restored** when that circuit is opened (on app load or when picked from
  the circuit selector);
- a **preview toggle** to compare the live placement against the saved one
  before overwriting, and a **revert** to go back to the saved one;
- **no** attempt list, names, or notes;
- **no** file export/import;
- **no** bundled example placements.

A multi-attempt "repository" and file export/import stay as an explicit
ROADMAP Phase 6+ option (see *Not in scope*).

## Vocabulary

A **saved placement** is the Phase 2 `Placement` (`anchor`, `rotationRad`,
`scale`) for one circuit, plus its `circuitId`, a `schemaVersion`, and a
`savedAt` timestamp. Nothing about the street data or the proximity result is
stored — both are recomputed on load.

The current on-screen placement has **unsaved changes** when it differs from the
saved placement for the current circuit (or when there is no saved placement).

## Decisions locked for this phase

- **Storage: `localStorage`, one key, an object keyed by `circuitId`.** All
  saved placements live under the single key `circuit-finder/placements` as a
  JSON object `{ [circuitId]: SavedPlacement }`. One entry per circuit; saving
  replaces the entry. A corrupt or absent value is treated as "nothing saved" —
  never throws on load. An entry that fails validation, or whose stored
  `circuitId` does not match its key, is dropped with a `console.warn`, so one
  bad record never hides the rest.
- **No backend, no network, no new dependency.** Same static-site constraints as
  every other phase.
- **Save always overwrites the current circuit's entry** from the current map
  state. If an entry already exists *and* there are unsaved changes, `onSave`
  asks for confirmation (`window.confirm`) before replacing it.
- **Auto-restore on open.** On app init, if a saved placement exists for the
  initial circuit, the app opens at it (circuit + placement) instead of the
  default. When the user picks a circuit from the selector, if that circuit has
  a saved placement it is loaded and the map pans to it; if it does not, the
  current placement is left as-is (Phase 2 behaviour).
- **Preview toggle.** When the current circuit has a saved placement *and* there
  are unsaved changes, the panel shows a **"Preview saved"** checkbox. While it
  is on, the overlay is drawn at the *saved* placement (visually distinct — a
  dashed, lower-opacity ring) without changing `AppState`; turning it off
  returns to the live placement. Picking a circuit, saving, reverting, or
  deleting all clear the toggle.
- **Revert.** A **"Revert to saved"** action loads the saved placement back into
  `AppState` (discarding the live unsaved edits) and pans the map to it. Only
  shown when a saved placement exists.
- **Delete.** A **"Delete saved"** action removes the current circuit's entry
  (after a `window.confirm`). The circuit then behaves as if never saved (opens
  at the default placement next time).
- **Load pans the map.** Auto-restore on a circuit pick, and Revert, both call
  `map.setView(anchor)` at the current zoom so the user sees the result.
- **`schemaVersion` on every stored entry.** Currently `1`.
- **Tests:** the saved-placement schema (validate, make, round-trip) and the
  stored-object parse/serialise are pure functions with full unit coverage.
  `localStorage` read/write gets a small jsdom test (including a corrupt value).
  The `loadPlacement` reducer is unit-tested. The Leaflet/DOM glue keeps a
  single jsdom smoke test, extended to "save → written to `localStorage` +
  panel updates → revert → state applied + map panned", plus "a pre-seeded save
  for the initial circuit is applied on init".

## Repository layout after this phase

```text
src/
├── placements.ts               # NEW SavedPlacement type, validation, (de)serialise, map ops (pure)
├── placements.test.ts
├── app/
│   ├── state.ts                # + loadPlacement reducer
│   ├── state.test.ts           # extended
│   ├── storage.ts              # NEW localStorage read/write for the placements object (thin glue)
│   ├── storage.test.ts         # jsdom; real localStorage + corrupt-value case
│   ├── map.ts                  # wire auto-restore / save / revert / delete / preview
│   └── map.test.ts             # extended smoke test
└── ui/
    ├── controls.ts             # + "Saved placement" section
    └── controls.test.ts        # extended
```

`circuits.ts`, `streets.ts`, `geometry/`, `porto.ts`, `app/overlay.ts`,
`app/rotate.ts`, `app/proximity.ts` are unchanged. No new data files.

## Data schema

### A saved placement (stored and in memory)

```ts
export type SavedPlacement = {
  schemaVersion: 1
  circuitId: string                   // non-empty
  anchor: readonly [number, number]   // [lon, lat]
  rotationRad: number                 // finite; stored as-is (not normalised)
  scale: number                       // finite, within [MIN_SCALE, MAX_SCALE]
  savedAt: string                     // ISO 8601 UTC
}
```

### `localStorage["circuit-finder/placements"]`

A JSON object `{ [circuitId]: SavedPlacement }`. Written whole on every change.

### Validation rules (`validatePlacement`)

Throws with a descriptive message on the first problem:

- object with all fields above present and of the right type;
- `schemaVersion === 1`;
- `circuitId` is a non-empty string (existence is checked by the caller against
  the live circuit list — a missing circuit is a load-time warning, not a schema
  error, so a value stored by a future build with more circuits still parses);
- `anchor` is `[lon, lat]` finite, `lon ∈ [-180, 180]`, `lat ∈ [-90, 90]`;
- `rotationRad` finite; `scale` finite and within `[MIN_SCALE, MAX_SCALE]`;
- `savedAt` parses as a valid date.

## New / changed code

### `placements.ts` (pure)

- `type SavedPlacement` (above), `PLACEMENTS_SCHEMA_VERSION = 1`.
- `validatePlacement(value: unknown): SavedPlacement`.
- `makeSavedPlacement(circuitId: string, placement: Placement, now: Date): SavedPlacement`.
- `savedToPlacement(s: SavedPlacement): Placement`.
- `getPlacement(store, circuitId): SavedPlacement | undefined`.
- `placementsEqual(a: Placement, b: Placement): boolean` — exact compare of
  `anchor` (both components), `rotationRad`, `scale`; used to derive "unsaved
  changes".
- Map ops on `Readonly<Record<string, SavedPlacement>>`, each returning a new
  object: `setPlacement(map, saved)`, `removePlacement(map, circuitId)`,
  `getPlacement(map, circuitId): SavedPlacement | undefined`.
- `parseStoredPlacements(raw: string | null): Record<string, SavedPlacement>` —
  tolerant: `null` / bad JSON / non-object / array → `{}`; per-entry invalid, or
  entry `circuitId` ≠ key → skipped with `console.warn`.
- `serialisePlacements(map: Readonly<Record<string, SavedPlacement>>): string`.

### `app/storage.ts` (thin glue)

- `STORAGE_KEY = 'circuit-finder/placements'`.
- `loadPlacements(): Record<string, SavedPlacement>` —
  `parseStoredPlacements(localStorage.getItem(KEY))`; wrapped so a
  `localStorage` that throws (private-mode, disabled) returns `{}`.
- `savePlacements(map: Readonly<Record<string, SavedPlacement>>): void` —
  `setItem`; swallow quota errors with a `console.warn` (the in-memory object
  stays authoritative for the session).

### `app/state.ts`

- `loadPlacement(state, circuits, circuitId, placement: Placement): AppState` —
  swaps to `circuitId` and applies `placement` wholesale. Throws if `circuitId`
  is not in `circuits` (the caller checks first and shows a message). Takes the
  already-decoded `Placement` (the caller runs `savedToPlacement`) so `state.ts`
  keeps no dependency on the `placements` module — otherwise `state` ↔
  `placements` would be a cycle (`placements` reads `MIN_SCALE`/`MAX_SCALE`).
  No `AppState` shape change — "which saved placement is on screen" is always
  just `state.circuitId`, and "unsaved changes" is derived by comparing
  `state.placement` to the stored entry.
- `initialState`, `selectCircuit`, `moveTo`, `rotateTo`, `setScale` unchanged.

### `ui/controls.ts`

`renderControls` gains a **"Saved placement"** section below the legend.

`ControlsView` gains:

- `saved: SavedPlacement | null` — the saved placement for the current circuit;
- `hasUnsavedChanges: boolean`;
- `previewingSaved: boolean`.

Rendered content:

- always: a **Save** button (`data-role="save"`);
- no `saved`: a line "No saved placement for this circuit.";
- with `saved`: a line "Saved {relative time}" (via a pure
  `formatSavedAgo(savedAt, now)` helper — "just now" / "N min ago" / "N h ago" /
  "N d ago" / "on YYYY-MM-DD"), a **Revert to saved** button
  (`data-role="revert"`), a **Delete saved** button (`data-role="delete-saved"`),
  and — only when `hasUnsavedChanges` — a **Preview saved** checkbox
  (`data-role="preview-saved"`, `checked` when `previewingSaved`).

`ControlsHandlers` gains: `onSave()`, `onRevertToSaved()`, `onDeleteSaved()`,
`onTogglePreviewSaved(show: boolean)`. Still pure render-to-string + explicit
`bind` that returns a disposer.

### `app/map.ts` (glue)

- On init: `let placements = loadPlacements()`. Build `state = initialState(...)`,
  then if `getPlacement(placements, state.circuitId)` exists,
  `state = loadPlacement(state, circuits, that)` and `map.setView` to its anchor.
- `renderPanel()` passes `saved`, `hasUnsavedChanges`
  (`!saved || !placementsEqual(state.placement, savedToPlacement(saved))`), and
  `previewingSaved` into `renderControls`.
- `onSave()`: if `saved` exists and `hasUnsavedChanges`, `window.confirm`
  ("Replace the saved placement for {circuit name}?"); on cancel, stop.
  Otherwise `placements = setPlacement(placements, makeSavedPlacement(circuitId,
  state.placement, new Date()))`, `savePlacements(placements)`,
  `previewingSaved = false`, `renderPanel()`.
- `onRevertToSaved()`: `state = loadPlacement(state, circuits, saved)`,
  `previewingSaved = false`, `map.setView(toLatLng(state.placement.anchor))`,
  `render()` + `renderPanel()`.
- `onDeleteSaved()`: `window.confirm` ("Delete the saved placement for {circuit
  name}?"); on ok, `placements = removePlacement(placements, circuitId)`,
  `savePlacements(placements)`, `previewingSaved = false`, `renderPanel()`.
- `onTogglePreviewSaved(show)`: `previewingSaved = show`; `render()`.
- `onSelectCircuit(id)` (existing handler, extended): `state = selectCircuit(...)`;
  `previewingSaved = false`; if `getPlacement(placements, id)` exists,
  `state = loadPlacement(state, circuits, that)` and `map.setView` to its anchor;
  `renderPanel()` + `render()`.
- `render()`: when `previewingSaved` and a saved placement exists, draw the
  overlay ring from `savedToPlacement(saved)` instead of `state.placement`, with
  a `preview` style (dashed, ~0.5 opacity); the rotate handle is hidden or
  frozen while previewing. Proximity colouring and the readout still reflect the
  drawn ring.
- Saved placements are the only thing written to `localStorage`; the proximity
  result is never stored.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `STORAGE_KEY` | `'circuit-finder/placements'` | the single `localStorage` key |
| `PLACEMENTS_SCHEMA_VERSION` | `1` | stored schema version |

`MIN_SCALE` / `MAX_SCALE` are reused from `app/state.ts`.

## Tests

All offline. Pure modules in the default vitest environment; `storage.test.ts`
and `map.test.ts` use `// @vitest-environment jsdom`.

- **`placements`**: `validatePlacement` accepts a good object and rejects each
  malformed field (missing, wrong type, out-of-range `scale`, bad date, bad
  `anchor`, wrong `schemaVersion`, blank `circuitId`); `makeSavedPlacement`
  copies the placement and sets `savedAt` from `now`; `savedToPlacement`
  round-trips; `placementsEqual` is true for equal, false for any one component
  differing; `setPlacement` / `removePlacement` are pure and immutable;
  `parseStoredPlacements` handles `null`, `"not json"`, `"[]"`, `"{}"`, an
  object with one good + one broken entry (keeps the good one), and an entry
  whose `circuitId` ≠ its key (dropped); `serialisePlacements` →
  `parseStoredPlacements` round-trips.
- **`storage` (jsdom)**: `savePlacements` then `loadPlacements` returns an equal
  object; a pre-seeded corrupt value yields `{}` and does not throw; key is
  exactly `circuit-finder/placements`.
- **`state`**: `loadPlacement` sets circuit + placement from the saved value;
  loading one whose circuit is unknown throws.
- **`controls`**: rendered HTML shows the Save button; with no `saved`, the
  "No saved placement" line; with `saved`, the relative-time line, Revert and
  Delete buttons, and — only when `hasUnsavedChanges` — the Preview checkbox;
  `bind` fires each handler; `formatSavedAgo` returns the expected buckets.
- **`map` (jsdom)**: after `createMapApp` with an empty store, calling the save
  handler writes `localStorage["circuit-finder/placements"]` and the panel now
  shows a saved-time line; moving the overlay then calling revert restores the
  saved ring and pans the map; `destroy()` still tears down cleanly. With a
  pre-seeded valid entry for the initial circuit, `createMapApp` opens at that
  placement.

## Acceptance criteria

- `npm run dev`: place a circuit, click **Save**, reload the page — the circuit
  reopens at the saved position, rotation and scale automatically.
- Picking a circuit that has a saved placement loads it and pans the map to it;
  picking one without a saved placement leaves the current placement alone.
- With unsaved changes over an existing save, **Preview saved** toggles the
  overlay between the live and the saved placement without changing anything;
  **Revert to saved** discards the live edits and returns to the saved
  placement.
- **Save** over an existing placement asks for confirmation first.
- **Delete saved** removes the entry (after a confirm); the circuit then opens
  at the default placement.
- No network request; no new runtime dependency. `localStorage` being
  unavailable degrades to a working-but-non-persistent session, not a crash.
- `npm run test:run` and `npm run build` pass.
- `docs/ROADMAP.md` (Phase 4 → `done`, dated decision-log entry, priority →
  Phase 5) and `RELEASES.md` updated per the working method.

## Not in scope

- More than one saved placement per circuit; a named library / "repository" of
  attempts with rename and notes (**ROADMAP Phase 6+**).
- File export / import of a placement, and any cross-device sync
  (**ROADMAP Phase 6+**).
- Bundled example placements.
- Route tracing, traced-route length, deviation from the circuit; the clean
  printable/screenshot study view (Phase 5).
- URL / query-string shareable state, deep links.
- Any server or account.
- Undo/redo of placement edits.
- Storing or caching the proximity result — always recomputed on load.
- GPX or any other format.
