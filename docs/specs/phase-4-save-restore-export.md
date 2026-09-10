# Spec — Phase 4: Save / restore / export

Status: `todo`
Depends on: [phase-2-map-overlay.md](phase-2-map-overlay.md),
[phase-3-street-proximity.md](phase-3-street-proximity.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Phases 2–3 let the user find a placement by eye and see how street-aligned it
is. This phase lets the user **keep** one. Save the current placement under a
name, see the list of saved placements, load one back onto the map, and move a
placement between machines as a JSON file.

From the vision: *"Save an attempt and reopen it later; export/import it as a
file."* No accounts, no backend — `localStorage` plus file download/upload, the
persistence model locked on 2026-09-08.

When this phase ships, the user can find a placement (Phase 2), judge it
(Phase 3), and now **return to it later**. Route tracing is still Phase 5.

## Vocabulary

An **attempt** is one saved placement: which circuit, where it sits, how it is
turned and scaled, plus a name, optional notes, and timestamps. It is exactly
the Phase 2 `Placement` plus `circuitId` plus metadata — nothing about the
street data or the proximity result is stored (both are recomputed on load).

## Decisions locked for this phase

- **Storage: `localStorage`, one key.** All attempts live under the single key
  `circuit-finder/attempts` as a JSON array, newest-relevant order decided by
  the UI (sort by `updatedAt` desc). No IndexedDB, no per-attempt keys. A
  corrupt or absent value is treated as "no attempts" — never throws on load.
- **No backend, no network.** Export is a client-side file download
  (`Blob` + object URL); import is a `<input type="file">` + `FileReader`. Same
  static-site constraints as every other phase.
- **Attempt identity: a generated `id`.** `crypto.randomUUID()` in the glue
  layer; the pure code takes the id as a parameter. Ids are stable across
  save/load/export/import-as-copy.
- **Save always creates a new attempt** from the current map state. Editing an
  existing attempt's *geometry* in place is out of scope — load it, adjust, save
  again. Renaming an attempt and editing its notes **are** supported (cheap,
  and expected for a "notes" field to be useful).
- **Load pans the map.** Loading an attempt sets the circuit, the placement, and
  calls `map.setView(anchor)` at the current zoom so the user sees it.
- **Import adds a copy.** An imported attempt gets a fresh `id` and
  `" (imported)"`-suffixed name if the name collides; it never overwrites an
  existing attempt. One attempt per file.
- **File format is self-identifying and versioned.** A wrapper object
  `{ app: "circuit-finder", kind: "attempt", version: 1, attempt: {…} }`.
  Import rejects anything whose `app`/`kind` don't match or whose `version` is
  newer than the app supports, with a readable message.
- **Bundled example attempts.** `src/data/example-attempts.json` ships two or
  three ready-made placements (validated by the same validator at load). They
  appear in the list under an "Examples" heading, are **load-only** (no delete,
  no rename), and loading one then saving creates a normal user attempt.
- **`schemaVersion` on every stored attempt.** Currently `1`. `loadAttempts`
  drops (with a `console.warn`, not a throw) any stored entry it cannot
  validate, so one bad record never hides the rest.
- **Tests:** the attempt schema (validate, serialise, round-trip), the list
  operations, and the file-wrapper build/parse are pure functions with full unit
  coverage. `localStorage` read/write and the example-data file each get one
  small test. The Leaflet/DOM glue keeps a single jsdom smoke test, extended to
  "save → appears in list → load → state applied".

## Repository layout after this phase

```text
src/
├── attempts.ts                  # NEW Attempt type, validation, (de)serialise, list ops (pure)
├── attempts.test.ts
├── app/
│   ├── state.ts                 # + loadAttempt reducer; AppState gains currentAttemptId?
│   ├── state.test.ts            # extended
│   ├── storage.ts               # NEW localStorage read/write for the attempts array (thin glue)
│   ├── storage.test.ts          # jsdom; real localStorage + corrupt-value case
│   ├── attempt-file.ts          # NEW build/parse the export wrapper, trigger download, read a File (glue + pure parse)
│   ├── attempt-file.test.ts
│   ├── map.ts                   # wire save / rename / delete / load / export / import
│   └── map.test.ts              # extended smoke test
├── ui/
│   ├── controls.ts              # + "Saved placements" section
│   └── controls.test.ts         # extended
└── data/
    ├── example-attempts.json        # NEW
    └── example-attempts.schema.md   # NEW schema + provenance
```

`circuits.ts`, `streets.ts`, `geometry/`, `porto.ts` are unchanged.

## Data schema

### An attempt (stored and in memory)

```ts
export type Attempt = {
  schemaVersion: 1
  id: string                 // uuid
  name: string               // 1–80 chars after trim
  notes: string              // 0–2000 chars ('' when none)
  circuitId: string          // must match a bundled circuit at load time
  anchor: readonly [number, number]   // [lon, lat]
  rotationRad: number        // finite; stored as-is (not normalised)
  scale: number              // finite, within [MIN_SCALE, MAX_SCALE]
  createdAt: string          // ISO 8601 UTC
  updatedAt: string          // ISO 8601 UTC
}
```

### `localStorage["circuit-finder/attempts"]`

A JSON array of `Attempt`. Written whole on every change.

### Export file — `<name>.circuit-finder.json`

```jsonc
{
  "app": "circuit-finder",
  "kind": "attempt",
  "version": 1,
  "attempt": { /* one Attempt object */ }
}
```

### `src/data/example-attempts.json`

A JSON array of `Attempt` (the same shape; `id`s are stable string literals
prefixed `example-`, timestamps fixed). Loaded and validated by
`loadExampleAttempts()`.

### Validation rules (`validateAttempt`)

Throws with a descriptive message on the first problem:

- object with all fields above present and of the right type;
- `schemaVersion === 1`;
- `name` trims to 1–80 chars; `notes` is a string ≤ 2000 chars;
- `circuitId` is a non-empty string (existence is checked by the caller against
  the live circuit list — a missing circuit is a load-time warning, not a schema
  error, so an export made on a future build with more circuits still parses);
- `anchor` is `[lon, lat]` finite, `lon ∈ [-180, 180]`, `lat ∈ [-90, 90]`;
- `rotationRad` finite; `scale` finite and within `[MIN_SCALE, MAX_SCALE]`;
- `createdAt` / `updatedAt` parse as valid dates.

## New / changed code

### `attempts.ts` (pure)

- `type Attempt` (above), `ATTEMPT_SCHEMA_VERSION = 1`.
- `validateAttempt(value: unknown): Attempt`.
- `makeAttempt(input: { name; notes; circuitId; placement: Placement }, id: string, now: Date): Attempt`
  — builds a fresh attempt (`createdAt === updatedAt === now`).
- `attemptToPlacement(a: Attempt): Placement` and the inverse helper used by
  `makeAttempt`.
- List ops on `readonly Attempt[]`, each returning a new array:
  `upsertAttempt`, `removeAttempt(id)`, `getAttempt(id)`,
  `renameAttempt(id, name, now)`, `setNotes(id, notes, now)`,
  `sortByUpdatedDesc`.
- `parseStoredAttempts(raw: string | null): Attempt[]` — tolerant: `null` /
  bad JSON / non-array → `[]`; per-element invalid → skipped with `console.warn`.
- `serialiseAttempts(list: readonly Attempt[]): string`.

### `app/attempt-file.ts`

- `buildAttemptFile(a: Attempt): string` — the wrapper JSON, pretty-printed.
- `parseAttemptFile(text: string): Attempt` (pure) — validates the wrapper
  (`app`, `kind`, `version <= 1`) then `validateAttempt(wrapper.attempt)`.
- `downloadAttempt(a: Attempt): void` — glue: `Blob`, object URL, synthetic
  `<a download>` click, `revokeObjectURL`. Filename from a slugified name.
- `readAttemptFile(file: File): Promise<Attempt>` — glue: `FileReader` →
  `parseAttemptFile`.

### `app/storage.ts` (thin glue)

- `STORAGE_KEY = 'circuit-finder/attempts'`.
- `loadAttempts(): Attempt[]` — `parseStoredAttempts(localStorage.getItem(KEY))`;
  wrapped so a `localStorage` that throws (private-mode quota, disabled) returns
  `[]`.
- `saveAttempts(list: readonly Attempt[]): void` — `setItem`; swallow quota
  errors with a `console.warn` (the in-memory list stays authoritative for the
  session).

### `app/state.ts`

- `AppState` gains `currentAttemptId: string | null` (which saved attempt, if
  any, the on-screen state came from — used only to highlight the list row;
  cleared by any move/rotate/scale/circuit change).
- `loadAttempt(state, circuits, attempt): AppState` — sets `circuitId`,
  `placement` from the attempt, `currentAttemptId = attempt.id`. If
  `attempt.circuitId` is not in `circuits`, throw (the caller checks first and
  shows a message).
- `moveTo` / `rotateTo` / `setScale` / `selectCircuit` also set
  `currentAttemptId = null`.

### `ui/controls.ts`

`renderControls` gains a **"Saved placements"** section below the readout:

- a text `<input data-role="attempt-name">` + **Save** button
  (`data-role="save"`);
- a `<ul data-role="attempt-list">` — one row per attempt: name, relative
  "saved" time, **Load** / **Export** / **Delete** buttons
  (`data-attempt-id` on the row); the row matching `currentAttemptId` gets an
  `aria-current` / highlight class; examples render in their own
  `<ul data-role="example-list">` with **Load** only;
- an **Import** control (`<input type="file" data-role="import" accept="application/json">`);
- optional `notes` `<textarea data-role="attempt-notes">` bound to the current
  attempt (visible only when one is loaded).

`bind` gains handlers: `onSave(name)`, `onLoadAttempt(id)`,
`onDeleteAttempt(id)`, `onExportAttempt(id)`, `onImportFile(file)`,
`onRenameAttempt(id, name)`, `onEditNotes(id, notes)`,
`onLoadExample(id)`. Still pure render-to-string + explicit `bind`.

`ControlsView` gains `attempts: readonly Attempt[]`, `examples: readonly
Attempt[]`, `currentAttemptId: string | null`.

### `app/map.ts` (glue)

- On init: `attempts = sortByUpdatedDesc(loadAttempts())`,
  `examples = loadExampleAttempts()`; render the panel with them.
- `onSave(name)`: `makeAttempt({ name, notes: '', circuitId, placement }, uuid,
  new Date())` → `upsertAttempt` → `saveAttempts` → re-render panel; set
  `currentAttemptId`.
- `onLoadAttempt(id)` / `onLoadExample(id)`: look up, check the circuit exists
  (else `window.alert` a message and stop), `state = loadAttempt(...)`,
  `map.setView(toLatLng(anchor))`, `render()` + `renderPanel()`.
- `onDeleteAttempt(id)`: `removeAttempt` → persist → re-render (a `confirm()`
  first).
- `onExportAttempt(id)`: `downloadAttempt(getAttempt(id))`.
- `onImportFile(file)`: `await readAttemptFile(file)`; on success add as a copy
  (fresh id, de-duped name), persist, re-render; on failure `window.alert` the
  error message.
- `onRenameAttempt` / `onEditNotes`: list op with `new Date()` → persist →
  re-render.
- Example attempts are never written to `localStorage`.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `STORAGE_KEY` | `'circuit-finder/attempts'` | the single `localStorage` key |
| `ATTEMPT_SCHEMA_VERSION` | `1` | stored + file schema version |
| `MAX_NAME_LEN` | `80` | attempt name length cap (after trim) |
| `MAX_NOTES_LEN` | `2000` | notes length cap |
| `FILE_APP` / `FILE_KIND` | `'circuit-finder'` / `'attempt'` | export-wrapper identity |

`MIN_SCALE` / `MAX_SCALE` are reused from `app/state.ts`.

## Tests

All offline. Pure modules in the default vitest environment; `storage.test.ts`
and `map.test.ts` use `// @vitest-environment jsdom`.

- **`attempts`**: `validateAttempt` accepts a good object and rejects each
  malformed field (missing, wrong type, out-of-range `scale`, bad date, name too
  long/blank, notes too long, wrong `schemaVersion`); `makeAttempt` sets equal
  timestamps and copies the placement; `attemptToPlacement` round-trips;
  `upsert`/`remove`/`rename`/`setNotes` are pure and immutable and bump
  `updatedAt`; `sortByUpdatedDesc` orders correctly; `parseStoredAttempts`
  handles `null`, `"not json"`, `"{}"`, `"[]"`, and an array with one good + one
  broken element (keeps the good one); `serialiseAttempts` → `parseStoredAttempts`
  round-trips a list.
- **`attempt-file`**: `buildAttemptFile` → `parseAttemptFile` round-trips;
  `parseAttemptFile` rejects wrong `app`, wrong `kind`, `version: 2`, a missing
  `attempt`, and a structurally invalid attempt, each with a distinct message.
- **`storage` (jsdom)**: `saveAttempts` then `loadAttempts` returns an equal
  list; a pre-seeded corrupt value yields `[]` and does not throw; key is
  exactly `circuit-finder/attempts`.
- **`state`**: `loadAttempt` sets circuit + placement + `currentAttemptId`;
  loading an attempt whose circuit is unknown throws; any subsequent
  `moveTo`/`rotateTo`/`setScale`/`selectCircuit` clears `currentAttemptId`.
- **`controls`**: rendered HTML shows the Save button, the name input, one row
  per attempt with Load/Export/Delete, the examples list with Load only, and the
  import file input; `bind` fires each handler with the right id / value;
  `currentAttemptId` row carries the highlight attribute.
- **`example-attempts.json` (real data)**: `loadExampleAttempts()` returns
  ≥ 2 attempts; every one passes `validateAttempt` and references a bundled
  circuit id; ids all start `example-`.
- **`map` (jsdom)**: after `createMapApp`, calling the save handler with a name
  adds a row to the list and writes `localStorage`; calling load on it applies
  the placement (overlay ring changes) and pans the map; `destroy()` still tears
  down cleanly.

## Acceptance criteria

- `npm run dev`: the user can type a name, click **Save**, and see the placement
  appear in a "Saved placements" list that survives a page reload.
- **Load** on a saved row (or an example) puts that circuit back on the map at
  the saved position, rotation and scale, and pans the map to it.
- **Delete** removes a row (after a confirm); **Export** downloads a
  `*.circuit-finder.json` file; **Import** of such a file adds it to the list as
  a copy, and a malformed file shows a readable error and changes nothing.
- Renaming an attempt and editing its notes persist.
- Two or three bundled **example** placements are present on a fresh install and
  are load-only.
- No network request; no new runtime dependency. `localStorage` being
  unavailable degrades to a working-but-non-persistent session, not a crash.
- `npm run test:run` and `npm run build` pass.
- `docs/ROADMAP.md` (Phase 4 → `done`, dated decision-log entry, priority →
  Phase 5) and `RELEASES.md` updated per the working method.

## Not in scope

- Route tracing, traced-route length, deviation from the circuit (Phase 5).
- The clean printable/screenshot study view (Phase 5).
- Bulk export/import (a whole library in one file), or exporting more than one
  attempt at a time.
- URL / query-string shareable state, deep links.
- Any server, account, or cross-device sync beyond hand-carrying a file.
- Editing a saved attempt's geometry without loading and re-saving it.
- Undo/redo of placement edits.
- Storing or caching the proximity result — it is always recomputed on load.
- GPX or any format other than the app's own JSON wrapper.
