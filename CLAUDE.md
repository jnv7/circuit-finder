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
```

## Layout

- `src/` — application code and colocated `*.test.ts` files.
- `src/data/` — bundled data (`circuits.json`).
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
