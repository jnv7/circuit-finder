# Spec — Phase 25: Routes page becomes the primary entry; clearer best-alternative picker

Status: `done` (2026-10-03)
Depends on: [phase-22-route-generator.md](phase-22-route-generator.md) (the data),
[phase-23-routes-page.md](phase-23-routes-page.md) (the page this phase changes)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Two independent, small changes bundled into one phase because both are about the
routes page's standing as the site's real entry point:

1. The generated-routes page becomes the site root; the manual drag/rotate tool
   steps back to a secondary, still-working page at its own URL.
2. The route picker shows each stored route's real deviation numbers up front and
   marks the best one, so a circuit where every alternative misses the bar (Monza,
   Baku today) is legible at a glance instead of reading as three uniform failures.

Functionally, the route-generation pipeline (Phase 22-24) is considered done; this
phase is presentation only. No generator, scoring, or data-file changes.

## How it stays true to the vision

- **"Judgement stays with the user. No automated 'match score' is required."** The
  picker's "Best" marker reuses the already-computed, already-ordered `rank` field
  (best-first by `worstRatio` in `src/route/escalate.ts`) — it does not compute or
  display a new number, and `worstRatio` itself is never shown.
- **"The primary output is a clear map view to study and memorise the route."** This
  is now literally what a visitor reaches first at the site root.
- **Move and rotate by hand** remains a real, supported workflow — the manual tool
  (`manual.html`, formerly `index.html`) is unchanged in behaviour, just no longer
  the default page. It stays because it is currently the only way to hand-adjust a
  placement for a circuit the automatic matcher can't clear the bar for (Monza, Baku).
- **Static and free.** Still two Vite entry points in the same `dist/`, no backend.

## Decisions locked for this phase

**A. Entry-point swap**

- Content swap, not a TypeScript rename: today's `routes.html` content becomes the
  new `index.html`; today's `index.html` content becomes `manual.html`. `src/main.ts`
  and `src/routesMain.ts` keep their names — only the two `.html` wrappers move.
- `vite.config.ts`: `rollupOptions.input` becomes `{ routes: 'index.html', manual:
  'manual.html' }`.
- `.github/workflows/deploy.yml`: the smoke-check loop's second path becomes
  `manual.html` (the root path, `""`, now implicitly covers the routes page).
- One plain link each way, same visual treatment as the existing `page-link` /
  `page-link-inline` CSS, just repointed: the routes page links to `manual.html`
  ("Manual tool →"); `manual.html` links back to `/` ("← Generated routes").
- `src/app/map.ts` and its tests are unchanged — the manual tool keeps working
  exactly as before, just at a new URL and no longer the default.
- `README.md`'s opening description and dev instructions are updated to describe
  the routes lookup as what a visitor reaches at the root, with one sentence noting
  the manual tool now lives at `manual.html`.

**B. Picker clarity**

- `src/app/routesPage.ts`'s `renderPicker`: each route button currently renders a
  single line (`Route N · meets/misses the bar`) and carries `route-btn--ok`/`--miss`
  classes that have no corresponding CSS rule today — only the selected
  (`aria-pressed`) button gets any visual treatment, which is why the picker reads as
  uniform. Fixed with:
  1. Real CSS for `.route-btn--ok` / `.route-btn--miss`, reusing the existing
     `.badge--ok`/`--miss` colors as a background/border tint on the button.
  2. A second line per button with the route's real numbers, from a new pure helper:
     ```ts
     // src/app/routeSummary.ts
     export function pickerSummaryLine(m: RouteEntry['metrics']): string
     // "34 m on average, 110 m at most · 1.30× the circuit's length"
     ```
  3. A visual "Best" pill (reusing the `.badge` style, a new `.badge--best` color),
     shown on the route with `rank === 1`, independent of pass/fail.
- Worked example — Monza (all three miss the bar):
  ```
  [Best] Route 1 · misses the bar
  34 m on average, 110 m at most · 1.30× the circuit's length

  Route 2 · misses the bar
  32 m on average, 126 m at most · 1.20× the circuit's length

  Route 3 · misses the bar
  42 m on average, 139 m at most · 1.28× the circuit's length
  ```
  Route 1 is visibly "the closest attempt" even though it fails, without clicking in.
- `renderDetails` is trimmed, not rewritten: the selected route's standalone
  "Meets/Misses the bar" badge and its "Strays from the circuit by..." line are
  removed — both are now shown, number for number, in the picker itself. Everything
  else in `renderDetails` stays: the `barMisses` list (gives each limit, not just the
  value — not duplicated), `Length X km (Y× the circuit)` (the picker only has the
  ratio), `Retraces P%`, `Shape distance` (Fréchet), area/start/OSM link/notes.

**C. Not in scope**

- Widening `src/data/porto-streets.json` / the Porto road-network mesh — a separate,
  larger future phase (its own size-budget/architecture decision; see the ROADMAP
  "Low priority" table and this phase's decision-log entry).
- Deleting `src/app/map.ts` or any of the manual tool's functionality or tests.
- Any new composite "match score."
- General visual/typography/spacing redesign beyond the specific CSS above.

## Repository layout after this phase

```text
index.html                       # was routes.html's content
manual.html                      # was index.html's content
vite.config.ts                   # rollupOptions.input renamed/repointed
.github/workflows/deploy.yml     # smoke check: "" and "manual.html"
README.md                        # describes the routes lookup as the root page
src/
├── main.ts                      # unchanged, now wired from manual.html
├── routesMain.ts                # unchanged, now wired from index.html
├── app/
│   ├── map.ts, map.test.ts      # unchanged
│   ├── routesPage.ts            # renderPicker/renderDetails changed
│   ├── routesPage.test.ts       # updated assertions
│   ├── routeSummary.ts          # new: pickerSummaryLine (pure)
│   └── routeSummary.test.ts     # new
└── style.css                    # route-btn--ok/--miss real styling, .badge--best
```

## New / changed code

```ts
// app/routeSummary.ts
export function pickerSummaryLine(m: RouteEntry['metrics']): string
```

`renderPicker` builds two `<span>`s per button (`route-btn__title`,
`route-btn__metrics`) instead of one flat `textContent`, plus a `.badge.badge--best`
child when `route.rank === 1`. `renderDetails` drops its `badge` element and the
"Strays from the circuit by..." line.

## Tests

- **`routeSummary.test.ts`**: exact strings for Monza's and Sepang's real stored
  metrics, plus a rounding-boundary case (e.g. a value like `34.049` rounds to `34 m`).
- **`routesPage.test.ts`**:
  - The "first available route" test drops its `badge` / "Strays from the circuit
    by..." assertions; gains assertions that rank 1's button carries the `Best`
    badge and shows its real mean/max/ratio numbers.
  - The "shows how a route misses" test drops its `badge` assertion, keeps the
    "misses the bar" text assertion.
  - New: a non-selected, non-rank-1 route's button shows its own real numbers (the
    direct regression test for this phase).
  - New: exactly one button carries the `Best` badge, always on `data-rank="1"`,
    regardless of which route is currently selected.
  - The real-data smoke test (every committed route file renders without throwing)
    needs no change in kind, but is checked against Monza/Baku (all-fail) and
    Sepang (mixed) during implementation.
- No existing test references `index.html`/`routes.html`/`manual.html` by name, so
  the entry-point swap itself needs no Vitest changes beyond what's listed above.

## Acceptance criteria

- `npm run build` and `npm run test:run` pass.
- `npm run dev`: `/` shows the routes lookup; `/manual.html` shows the drag/rotate
  tool; each links to the other once.
- Opening Monza or Baku shows three buttons with distinct real numbers and exactly
  one marked `Best`; the ok/miss tinting is visible without needing to select a route.
- Opening Sepang shows the mixed pass/fail case correctly; `Best` lands on rank 1
  regardless of its own pass/fail state.
- The deploy smoke check passes on both `/` and `/manual.html` after the next push.
- `docs/ROADMAP.md` and `RELEASES.md` updated per the working method.

## Not in scope

See "C. Not in scope" above.

## Open questions

None outstanding — the entry-point naming (`manual.html`), link direction, and
"Best" presentation (a pill badge, not inline text) were settled with the user
before implementation.
