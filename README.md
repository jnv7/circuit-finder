# circuit-finder

Find running routes shaped like Formula 1 season circuits.

Overlay a circuit outline on a map of Porto at real-world scale, slide and rotate
it by hand until it lines up with a set of streets, then trace and save the loop
so you can memorise it before a run — like moving a sheet of acetate over a paper
map.

**Status:** early exploration.

## Development

Requires Node 20 or newer.

```sh
npm install
npm run dev        # local dev server
npm run test       # watch tests
npm run build      # type-check + production build
```

## Deployment

Pushes to `main` run tests + build and publish `dist/` to **GitHub Pages**
(`.github/workflows/deploy.yml`), served at
`https://<user>.github.io/circuit-finder/`. The Vite `base` is
`/circuit-finder/`. Enable it once under *Settings → Pages → Build and
deployment → Source: GitHub Actions*.

## Docs

- [Release notes](RELEASES.md) — what each release lets you do.
- [Vision](docs/VISION.md) — the product goal and principles.
- [Roadmap](docs/ROADMAP.md) — phases, priorities, and decision log.
- [Conventions](CONVENTIONS.md) — engineering rules.
