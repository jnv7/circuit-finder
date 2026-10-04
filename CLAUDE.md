# CLAUDE.md

circuit-finder: a static web tool to overlay Formula 1 season circuits on a map of
Porto at real-world scale, move and rotate them by hand to find a runnable
look-alike loop, and save the attempt. See [docs/VISION.md](docs/VISION.md) and
[docs/ROADMAP.md](docs/ROADMAP.md).

## Rules

See [CONVENTIONS.md](CONVENTIONS.md). In short: TypeScript only, English only,
automated tests always (Vitest, fast and offline), functional first, static site
deployable to GitHub Pages with no backend.

## Run

Node was installed from the official prebuilt tarball to `~/.local/node`
(`~/.zshrc` and `~/.bash_profile` add it to `PATH`). In a non-login shell,
prefix commands with `export PATH="$HOME/.local/node/bin:$PATH"`.

```sh
npm install       # first time
npm run dev        # local dev server
npm run test       # watch tests
npm run test:run   # run tests once (used by CI)
npm run build      # type-check (tsc --noEmit) + production build to dist/
npm run find-route -- "Monza"     # dev-only: circuit name -> circuits.json + stored routes across the metro regions (Phase 24/26)
npm run generate-route -- <id>    # dev-only: just the route generator for a bundled circuit, every region by default (Phase 22/26)
npm run extract-region -- <regionId> --bbox w,s,e,n  # dev-only: fetch+commit one region's street network (Phase 26)
```

Both `find-route` and `generate-route` take a repeatable `--region <id>` flag
(ids in `src/regions.ts`) to search only a subset; omitted, every region in
`src/regions.ts` runs. **As of 2026-10-04, `src/regions.ts` has 6 official
regions (added Póvoa de Varzim, revised 3 others' boundaries) but committed
data hasn't caught up** — `src/data/regions/` and every `src/data/routes/
*.json` still reflect the *previous* 5-region boundaries, and Póvoa has no
street file at all yet. Running either CLI without `--region` fails loudly on
Póvoa until that's fetched; see the ROADMAP decision log, 2026-10-04.

`find-route`/`extract-region` use the network only to fetch (a new circuit via
Wikidata + Overpass, or a region's street data via Overpass), cached in the
gitignored `.cache/`; the shipped site never fetches.

## Layout

- `src/` — application code and colocated `*.test.ts` files.
- `src/data/` — bundled data: `circuits.json`, `routes/` (generated routes),
  `regions/` — every region's street network, Phase 26, including Porto's own
  (`porto-streets.json`, Phase 3's original asset, moved here 2026-10-04 for
  directory consistency; content/schema unchanged).
- `src/regions.ts` — the official region ids/labels/bboxes; lightweight, no
  street data, safe for the browser bundle.
- `src/extract/` — dev-only pure modules behind `find-route`/`extract-region`
  (Wikidata/Overpass parsing, ring finding, region street-network building);
  not imported by the app. `scripts/` — the CLIs, `scripts/lib/` their shared
  logic (including `regionNetworks.ts`, which loads a region's full street
  data — dev-only, never bundled).
- `docs/` — `VISION.md`, `ROADMAP.md`, and `specs/` (one spec per phase).
- `.github/workflows/deploy.yml` — runs tests + build on every push/PR, and
  deploys `dist/` to GitHub Pages from `main`.

## Working method

Each roadmap phase gets a spec in `docs/specs/` before implementation. After
finishing a phase:

- update `docs/ROADMAP.md`: mark the phase `done`, add a dated decision-log
  entry, and move "Current priority" to the next phase;
- add a user-facing entry to `RELEASES.md` describing what the release lets the
  user do, see, or look up (not the engineering detail).
