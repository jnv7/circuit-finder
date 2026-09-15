# Spec — Phase 16: Fix the flaky real-data tests (share the graph fixture, give heavy tests a real timeout)

Status: `todo`
Depends on: none (test-infrastructure only)
See: [../ROADMAP.md](../ROADMAP.md), [../../CONVENTIONS.md](../../CONVENTIONS.md),
[../reviews/2026-09-13-suggested-placements-review.md](../reviews/2026-09-13-suggested-placements-review.md)

## Goal

Every phase since Phase 10 has noted the same "known, not a regression"
timeout pattern: `graph.test.ts`'s real-data connectivity check and several
`app/map.test.ts` cases fail with Vitest's default 5000 ms timeout under
heavy parallel load, and pass cleanly re-run in isolation. On 2026-09-14 this
stopped being a local nuisance: the same class of failure hit
**`npm run test:run` on GitHub Actions itself** (a genuinely resource-limited
2-vCPU runner), for the Phase 15 push — blocking `npm run build` and the
deploy step entirely and leaving the published site serving stale/broken
content (see [phase-17](phase-17-harden-deploy-pipeline.md) for that
consequence). Four phases of "known, not a regression" is a real cost, not a
curiosity, and it just took down a real deploy.

**Measured root cause, not assumed**: `buildStreetGraph(network.ways)` on the
full bundled network (26 994 ways, 37 653 resulting nodes) takes **~2.9
seconds** on a quiet, unloaded machine — before any contention at all.
`app/map.test.ts` calls `createMapApp(container, circuits)` — which builds
the network, street index, and graph fresh, every time — at **18 separate
call sites**, one per test. That is up to ~52 seconds of pure, repeated,
identical graph-building work in one file, all of it happening inside
Vitest's default 5000 ms per-test timeout, which leaves as little as ~2.1 s of
margin for everything else the test does (mount, render, dispatch events,
assert) *before any contention is added* — parallel workers locally, or a
slower/shared CPU on CI. `graph.test.ts`'s own real-data test builds the same
graph once, standalone, with the same unprotected 5000 ms default.

This is two fixable things, not one unfixable flakiness:

1. **`app/map.test.ts` does 18× the necessary work.** The network/index/graph
   are pure functions of the same static bundled data — nothing about them
   varies per test. Building them once and sharing them removes ~49 s of
   redundant work from this file alone.
2. **Every other real-data test in this codebase already gives itself an
   explicit, generous timeout** (`match/search.test.ts`,
   `match/landmarks.test.ts`'s real-data cases pass `120_000`-`180_000` as
   the third `it(...)` argument) — `graph.test.ts`'s real-data test and all of
   `app/map.test.ts` never did. That is an inconsistency to fix, not a
   deliberate choice, and it is the actual reason a single slow build (under
   contention, however that contention arises) fails a test outright instead
   of just running a bit long.

## How it stays true to the project's conventions

- **CONVENTIONS.md: "the default test suite must pass before any work is
  considered done."** A test suite that is known-flaky under load has been
  quietly failing this bar for four phases; this phase actually closes it.
- **Tests are fast where they can be, honest about being slow where they
  can't.** Sharing the fixture makes the *fast* path (17 of 18
  `app/map.test.ts` cases don't need a fresh 2.9 s build at all) actually
  fast; an explicit generous timeout on the one genuinely CPU-heavy build per
  file is honest about what it costs, the same pattern already used
  elsewhere in this codebase.
- **No behaviour change to the shipped app.** `createMapApp`'s new
  dependency-injection parameter is optional and defaults to exactly today's
  behaviour — the one real production call site (`main.ts`) is unaffected.

## Decisions locked for this phase

- **`createMapApp` gains an optional fourth argument for pre-built
  dependencies**, defaulting to building them itself (today's behaviour) when
  omitted:
  ```ts
  export type MapAppDeps = {
    network?: StreetNetwork
    streetIndex?: StreetIndex
    streetGraph?: StreetGraph
  }
  export function createMapApp(
    container: HTMLElement,
    circuits: readonly MetricCircuit[],
    deps?: MapAppDeps,
  ): MapApp
  ```
  `main.ts` (the one production caller) is unchanged — no `deps` passed, same
  behaviour as today.
- **`app/map.test.ts` builds `network`/`streetIndex`/`streetGraph` once, in a
  module-level `beforeAll`**, and every one of its 18 `createMapApp(...)`
  call sites passes them in via the new `deps` parameter. `beforeAll`, not
  `beforeEach`: the graph/index/network are read-only and never mutated by
  anything under test (confirmed: nothing in `app/map.ts` or its reducers
  writes back into the graph/index/network objects), so sharing one instance
  across every test in the file is safe, not just faster.
- **`graph.test.ts`'s real-data test and every `app/map.test.ts` test case
  get an explicit timeout**, sized the same generous way the codebase's
  other real-data tests already are — a fixed, large margin over the
  measured cost, not a number tuned to "just barely pass today": `30_000`
  for `graph.test.ts`'s single real-data case (its own ~2.9 s build plus
  margin), and raising `app/map.test.ts`'s per-test timeout to `15_000`
  (covering the *rare* build fallback path for any test that doesn't go
  through the shared fixture, plus real margin for jsdom/Leaflet mounting
  under contention) rather than leaving it at the 5000 ms global default.
  This is defense in depth on top of the shared-fixture fix, not a
  replacement for it — the fixture removes the redundant work, the timeout
  protects against the one build that's still genuinely necessary.
- **No change to `buildStreetGraph`'s own algorithm or performance.**
  ~2.9 s for a 27k-way, 38k-node graph with three repair passes is a
  separate, bigger, riskier optimisation question (see *Not in scope*) — this
  phase fixes *how many times* the test suite pays that cost and *how much
  time* a test is honestly given to pay it once, not the cost itself.

## Repository layout after this phase

```text
src/
├── app/
│   ├── map.ts        # createMapApp gains optional MapAppDeps param
│   └── map.test.ts   # beforeAll builds network/index/graph once; every
│                      # createMapApp(...) call passes them; explicit timeouts
└── graph.test.ts     # real-data test gets an explicit timeout
```

No new files, no new dependency, no change to any other source file.

## New / changed code

### `src/app/map.ts`

```ts
import type { StreetNetwork, StreetIndex } from '../streets'
import type { StreetGraph } from '../graph'

export type MapAppDeps = {
  network?: StreetNetwork
  streetIndex?: StreetIndex
  streetGraph?: StreetGraph
}

export function createMapApp(
  container: HTMLElement,
  circuits: readonly MetricCircuit[],
  deps: MapAppDeps = {},
): MapApp {
  // ...
  const network = deps.network ?? loadStreetNetwork()
  const streetIndex = deps.streetIndex ?? buildStreetIndex(network.ways)
  const streetGraph = deps.streetGraph ?? buildStreetGraph(network.ways)
  // ...unchanged from here down...
}
```

(`streetIndex`/`streetGraph` still default from `network.ways` when only
`deps.network` is supplied but not the other two, so a caller can override
just one piece if ever useful — not needed by this phase's own tests, which
always supply all three together, but a cheap, correct generalisation of the
same `??` pattern.)

### `src/app/map.test.ts`

```ts
import { loadStreetNetwork, buildStreetIndex } from '../streets'
import { buildStreetGraph } from '../graph'

// Built once for the whole file: a pure function of the same static bundled
// data every test already implicitly depended on, so there is nothing to
// isolate between tests by rebuilding it — see Phase 16.
let network: StreetNetwork
let streetIndex: StreetIndex
let streetGraph: StreetGraph
beforeAll(() => {
  network = loadStreetNetwork()
  streetIndex = buildStreetIndex(network.ways)
  streetGraph = buildStreetGraph(network.ways)
})

// every existing call site:
// const app = createMapApp(container, circuits)
// becomes:
const app = createMapApp(container, circuits, { network, streetIndex, streetGraph })
```

Every `it(...)` in the file also gets an explicit `15_000` timeout (fourth
constructor form: `it('...', () => { ... }, 15_000)`), or the file-level
default is raised via `describe.concurrent`'s options / a `{ timeout: 15_000
}` passed once where the suite's outer `describe` is declared — implementer's
choice of whichever reads cleaner, the contract is every test in this file
has an explicit 15 s budget, not the 5 s global default.

### `src/graph.test.ts`

```ts
describe('buildStreetGraph (real data)', () => {
  it(
    'is materially connected: the largest component covers most of the network length',
    () => {
      // ...unchanged body...
    },
    30_000,
  )
})
```

## Constants

| name | value | meaning |
| --- | --- | --- |
| `app/map.test.ts` per-test timeout | `15_000` ms | generous margin over jsdom mount + the rare fallback build |
| `graph.test.ts` real-data test timeout | `30_000` ms | generous margin over the measured ~2.9 s graph build |

Both are fixed, deliberately generous numbers (not tuned to "just barely
pass on this machine today") — the point is removing timing brittleness, not
finding the tightest number that happens to work right now.

## Tests

This phase *is* a test-infrastructure fix; its own verification is running
the suite, not new unit tests of application behaviour:

- `npm run test:run` passes with **zero** changes to any assertion's
  expected behaviour — every existing `expect(...)` in `app/map.test.ts` and
  `graph.test.ts` is unchanged; only how the graph/index/network reach each
  test, and how much time each test is given, change.
- Verify the fix under realistic contention, not just a quiet machine: run
  `npx vitest run --maxWorkers=2` (approximating a 2-vCPU GitHub Actions
  runner) at least twice in a row and confirm no timeout failures either
  time — this is the closest local approximation available to the actual CI
  environment that failed on 2026-09-14 (no access to that job's raw log to
  confirm the exact failure line; the fix targets the measured, confirmed
  cost driver either way).
- Time `app/map.test.ts` alone before and after
  (`npx vitest run src/app/map.test.ts`) and report the wall-clock
  difference in the ROADMAP decision log — expect a large reduction (up to
  ~49 s of redundant graph-building removed, per the measurement above).

## Acceptance criteria

- `npm run build` and `npm run test:run` pass, including at least two
  consecutive runs under `--maxWorkers=2`.
- No test's expected behaviour changed — this is purely about how fast and
  how reliably the suite reaches those same assertions.
- `docs/ROADMAP.md` updated: Phase 16 → `done`, dated decision-log entry with
  the before/after `app/map.test.ts` timing and confirmation of clean
  `--maxWorkers=2` runs, "Current priority" moved to
  [phase-17](phase-17-harden-deploy-pipeline.md).

## Not in scope

- **Optimising `buildStreetGraph`'s own algorithm.** ~2.9 s for 27k ways
  with three repair passes (endpoint merge, T-junction split, crossing/
  corridor detection) may well have room to improve, but that is a
  performance project with its own correctness risk (these passes are
  exactly what Phase 7/9 spent real effort getting right) — not bundled into
  a test-reliability fix.
- **Changing Vitest's global `testTimeout` default**, `pool`, or
  `isolate` setting in `vite.config.ts`. Vitest's own diagnostic output
  already suggests `isolate: false` could shave real time off the whole
  suite — a legitimate follow-up, but a global setting change is a different,
  broader risk surface than the two targeted fixes here (which are scoped to
  exactly the files that need them) and is better evaluated on its own after
  this phase's more surgical fix is confirmed sufficient.
- **Sharing the graph fixture across *other* test files** (e.g.
  `match/search.test.ts`'s real-data case builds its own network/index once
  per file already, which is the correct granularity — only
  `app/map.test.ts`, with its 18 per-test rebuilds, has the multiplication
  problem this phase fixes).
