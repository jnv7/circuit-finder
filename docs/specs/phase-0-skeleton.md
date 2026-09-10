# Spec — Phase 0: Skeleton + CI

Status: `done` (2026-09-09)
Depends on: nothing
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Stand up the project so that every later phase has a working, tested, deployable
base. No product features yet — just the smallest end-to-end slice: the app
builds, loads the circuit list from data, renders it, and the test + deploy
pipeline is green.

## Decisions locked for this phase

- **Frontend:** plain TypeScript modules + Vite. No UI framework.
- **Tests:** Vitest, pure functions only in this phase (no DOM environment yet).
- **Package manager:** npm. **Node:** 20 LTS or newer (implemented on Node 24;
  see "Implementation notes").
- **Deploy target:** GitLab Pages **project site**, served at
  `https://<user>.gitlab.io/circuit-finder/`. Vite `base` = `/circuit-finder/`.
- **Circuit data:** imported as a typed JSON module. Runtime `fetch` of a static
  asset and the full schema are deferred to Phase 1.
- **Lint/format tooling (eslint/prettier):** deferred to a later phase.
  `tsc --noEmit` in strict mode is the type gate for now.

## Repository layout after this phase

```text
circuit-finder/
├── .gitlab-ci.yml
├── .gitignore
├── CLAUDE.md
├── CONVENTIONS.md
├── README.md
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   ├── VISION.md
│   ├── ROADMAP.md
│   └── specs/
│       └── phase-0-skeleton.md
└── src/
    ├── main.ts
    ├── circuits.ts
    ├── circuits.test.ts
    └── data/
        └── circuits.json
```

## Work items

### 1. Tooling

- `package.json` with scripts:
  - `dev` → `vite`
  - `build` → `tsc --noEmit && vite build`
  - `preview` → `vite preview`
  - `test` → `vitest`
  - `test:run` → `vitest run`
- Dependencies: `vite`, `typescript`, `vitest`. Nothing else.
- `tsconfig.json`: `strict: true`, `resolveJsonModule: true`, `noEmit: true`,
  modern target/module (ES2022 / bundler resolution).
- `vite.config.ts`: `base: '/circuit-finder/'`. Keep Vite's default `dist/`
  output; do not add a repo-level `public/` directory.
- `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `.DS_Store`.

### 2. Circuit data (provisional)

`src/data/circuits.json` — an array of circuits with only the fields needed to
prove the load-and-list path. Geometry and real dimensions arrive in Phase 1.

```json
[
  { "id": "madrid",      "name": "Madrid",      "location": { "lat": 40.4637, "lon": -3.6109 } },
  { "id": "monaco",      "name": "Monaco",      "location": { "lat": 43.7347, "lon": 7.4206  } },
  { "id": "silverstone", "name": "Silverstone", "location": { "lat": 52.0733, "lon": -1.0147 } }
]
```

Add a short comment in `circuits.ts` (not the JSON) noting the coordinates are
approximate placeholders pending Phase 1.

### 3. Application code

- `src/circuits.ts`:
  - `type Circuit = { id: string; name: string; location: { lat: number; lon: number } }`
  - `loadCircuits(): Circuit[]` — returns the imported data, typed.
  - `validateCircuits(data: unknown): Circuit[]` — throws on: not an array,
    empty array, missing/empty `id` or `name`, `lat` outside [-90, 90], `lon`
    outside [-180, 180], duplicate `id`. Returns the typed array on success.
  - `renderCircuitList(circuits: Circuit[]): string` — returns an HTML string for
    a `<ul>` of circuits (name + formatted coordinates). Pure; no DOM access.
- `src/main.ts`:
  - On load, call `loadCircuits()` then `validateCircuits(...)`, set
    `#app` `innerHTML` to a heading plus `renderCircuitList(...)`.
- `index.html`: minimal document with `<div id="app"></div>` and
  `<script type="module" src="/src/main.ts">`.

### 4. Tests — `src/circuits.test.ts`

- `loadCircuits()` returns a non-empty array.
- Every loaded circuit passes `validateCircuits` (round-trips).
- `validateCircuits` throws for: non-array input, empty array, a circuit with
  blank `name`, `lat` = 100, `lon` = 200, and two circuits sharing an `id`.
- `renderCircuitList` output contains each circuit's name and is valid-ish markup
  (starts with `<ul`, ends with `</ul>`, one `<li` per circuit).

### 5. CI — `.gitlab-ci.yml`

```yaml
stages: [test, deploy]

default:
  image: node:20-alpine
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  before_script:
    - npm ci --cache .npm --prefer-offline

test:
  stage: test
  script:
    - npm run test:run
    - npm run build

pages:
  stage: deploy
  script:
    - npm run build
    - mv dist public
  artifacts:
    paths: [public]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Note: no GitLab remote is configured yet. The file is inert until the repo is
pushed to GitLab; it is not tested in this environment beyond YAML validity.

### 6. Docs

- `CLAUDE.md`: project one-liner, how to run (`npm install`, `npm run dev`,
  `npm run test`), the repo layout above, and a pointer to `CONVENTIONS.md` /
  `docs/`.
- `README.md`: replace the stub with a short description, a "Status: early
  exploration" line, local dev commands, and links to `docs/VISION.md` and
  `docs/ROADMAP.md`.

## Acceptance criteria

- `npm install` then `npm run test:run` passes locally.
- `npm run build` produces `dist/` with `base` `/circuit-finder/` in the emitted
  asset paths.
- `npm run dev` serves a page listing the three circuits with their coordinates.
- `tsc --noEmit` reports no errors.
- `.gitlab-ci.yml` is valid YAML with `test` and `pages` jobs as above.
- `docs/ROADMAP.md` updated: Phase 0 → `done`, decision-log entry added,
  "Current priority" moved to Phase 1.

## Implementation notes (2026-09-09)

- No Node toolchain existed on the machine. A `brew install node` pulled in a
  from-source build of cmake (no bottle for this macOS), so it was aborted.
  Instead, the official prebuilt Node 24.21.0 (`darwin-x64`) tarball was unpacked
  to `~/.local/node`, and `export PATH="$HOME/.local/node/bin:$PATH"` was added to
  `~/.zshrc` and `~/.bash_profile` (both were created; neither existed).
- Dependency majors landed ahead of the spec's placeholder ranges:
  `typescript@7`, `vite@8`, `vitest@5`. `npm audit` reports 0 vulnerabilities.
- CI image bumped `node:20-alpine` → `node:24-alpine` to match local and satisfy
  Vite 8's Node floor.
- Results: `npm run test:run` → 9/9 pass. `npm run build` → `tsc` clean, `dist/`
  emitted with `/circuit-finder/` asset paths. `npm run preview` serves the built
  page at `/circuit-finder/`.

## Not in scope

- Any map, Leaflet, or overlay.
- Circuit geometry, real dimensions, or the final `circuits.json` schema.
- `fetch`-based data loading.
- Persistence, export/import.
- eslint / prettier.
- Actually deploying to GitLab (no remote yet).
