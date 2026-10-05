# Spec — Phase 27: split `find-route` into `extract-circuit` + `generate-route`

Status: `done` (implemented 2026-10-05)
Depends on: [phase-24-find-route-by-name.md](phase-24-find-route-by-name.md)
(the command this phase splits), [phase-22-route-generator.md](phase-22-route-generator.md)
(stage 2, unchanged), [phase-26-regional-search.md](phase-26-regional-search.md)
(the `--region` flag, unchanged)
Supersedes: [phase-24-find-route-by-name.md](phase-24-find-route-by-name.md)'s
`find-route` command (its extraction *logic* is unchanged and kept — only the
CLI that drove it is replaced)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Now that every circuit on the current calendar has been fetched at least
once, stage 1 (fetch a circuit's data) is not expected to run again for a
while, while stage 2 (search an already-bundled circuit's route against the
region meshes) keeps running regularly — re-runs, new regions, tuning.
`find-route.ts` bundled both behind one command, so every stage-2-only use
had to carry stage 1's flags and code path along with it. Split them into
two single-purpose CLIs that match how they're actually used:

- **`extract-circuit`** — a circuit's name in, `circuits.json` entry out.
  Fetches from Wikidata + Overpass. Generic: nothing about any specific
  circuit is hardcoded, and every refusal (no Wikidata match, ambiguous
  entity, no ring found, ambiguous ring, too many cycles, unsupported
  length unit, …) already prints the flag that resolves it.
- **`generate-route`** — a bundled circuit's id in, its route(s) against the
  region street meshes out. Already existed as a stage-2-only command;
  unchanged in behaviour except it now also prints `extract-circuit`'s old
  final per-region/bar-misses summary, so nothing about the merged tool's
  output is lost by the split.

`extract-region` (region street-mesh fetching) is untouched — it was already
a separate, single-purpose CLI before this phase.

No change to extraction or search *behaviour*: this is a CLI-layer
reorganisation only. `src/extract/extract.ts` and the modules it calls are
moved, not rewritten.

## Decisions

- **New file, not a rename-in-place**: `scripts/extract-circuit.ts` replaces
  `scripts/find-route.ts` (deleted). Carries over stage 1 almost verbatim —
  the already-bundled check (`matchBundled`), the cache-backed
  `createJsonClient`, `extractCircuit`/`applyExtraction`/`writeAtomic` — and
  drops everything that was stage-2-only: `--extract-only` (meaningless
  with no stage 2 to skip), `--scale`, `--region`, the
  `generateAndWriteRoute` call and its printing block.
- On a successful write (not `--dry-run`), it prints one line pointing at
  the next step: `next: npm run generate-route -- <circuitId>` — the same
  pointer `find-route.ts` already gave on a stage-2 *failure*, now given
  unconditionally on stage 1 success, since there is no automatic stage 2
  to fall back to anymore.
- Identity details renamed for the new tool: `USER_AGENT` →
  `circuit-finder-extract-circuit/1.0 (...)`, cache dir `.cache/find-route`
  → `.cache/extract-circuit`.
- **`generate-route.ts` gains the final summary** `find-route.ts` used to
  print after stage 2 (per-region route count, escalation tier, poses
  searched, and each route's bar-misses via `src/app/barMisses`) — today it
  only logs progress as it runs. Progress logging itself
  (`scripts/lib/generate.ts`'s `log()` callback, threaded through every
  stage) is unchanged; it already streams as it happens via `console.log`,
  nothing was buffered.
- **Comments and docs that describe current behaviour** (not a dated
  decision-log entry) are updated to name `extract-circuit` instead of
  `find-route`: the `src/extract/*.ts` module headers, `scripts/lib/
  generate.ts`, `src/regions.ts`, `src/circuits.test.ts`,
  `src/data/circuits.schema.md`'s Provenance section, `CLAUDE.md`,
  `package.json`, `.gitignore`. Historical decision-log prose in
  `docs/ROADMAP.md` and the `docs/specs/phase-19/24/26-*.md` files is left
  as written — it is a dated record of what was true when it was written,
  not a description of current behaviour.

## Repository layout after this phase

```text
.cache/extract-circuit/            # gitignored response cache (was .cache/find-route/)
scripts/
├── extract-circuit.ts             # new: stage 1 only (was find-route.ts's stage 1)
├── generate-route.ts              # stage 2 only; gained the final summary
└── lib/
    └── generate.ts                # unchanged behaviour; now only called by generate-route
```

`scripts/find-route.ts` is deleted. `src/extract/`, `src/route/`,
`scripts/lib/regionNetworks.ts`, `scripts/extract-region.ts` are unchanged.

## Not in scope

- Any change to extraction logic, the ring/cycle search, or route
  generation/search behaviour.
- Any change to `extract-region.ts`.
- Rewriting historical `docs/ROADMAP.md` decision-log entries or past
  specs' own body text to say `extract-circuit` instead of `find-route` —
  they describe what was true on the date they were written.

## Acceptance criteria

- `npm run test:run` and `npm run build` pass.
- `npm run extract-circuit -- "<an already-bundled circuit>"` performs no
  network requests, prints the bundled summary, and does **not** touch
  routes (no stage 2).
- `npm run generate-route -- <id> --region porto` runs end to end and
  prints both progress logs and the final per-region/bar-misses summary.
- No remaining reference to `find-route` in current (non-historical) code
  or docs.
