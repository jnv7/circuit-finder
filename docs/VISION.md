# Vision

## Problem

Every race weekend of the F1 season features a circuit. As a runner, I want to run
a route in my city that looks like the current weekend's circuit — for example,
during the Madrid Grand Prix week, run something in Porto shaped roughly like the
Madrid circuit, at the same real-world scale.

## The idea, by analogy

If I did this by hand I would:

1. Trace the circuit outline onto a sheet of acetate, at the **same scale** as my
   printed map of Porto.
2. Slide and rotate the transparency over the map until the shape lines up
   *roughly* with a set of real streets — it does not need to be a perfect match.
3. Mark the resulting loop on the map so I can memorise it before the run.

The product is that acetate workflow, on a web map.

## Target user

A single runner (the author), planning routes for personal training. No accounts,
no multi-user features.

## Goals

- Overlay a season circuit's centreline on a map, at real-world scale.
- Move and rotate the overlay by hand to find a plausible location.
- Read the resulting loop length and longest straight in metres/kilometres.
- Trace the actual running route along real streets, following the overlay.
- Save an attempt and reopen it later; export/import it as a file.
- The primary output is a clear map view to **study and memorise** the route.

## Principles

- **Functional first.** Every phase ships something that runs, even if rough.
- **Judgement stays with the user.** No automated "match score" is required for
  the core workflow; the user decides what looks close enough.
- **Static and free.** Runs as a static site on GitHub Pages. No backend, no
  database, no paid services, minimal dependencies.
- **One language.** TypeScript everywhere; English for all code and docs.
- **Real scale by default.** Metres are metres. A 2 km straight on the circuit is
  a ~2 km straight on the route.

## Non-goals

- Elevation / altitude matching.
- Mirrored (reflected) circuit placements.
- GPX export as a priority (may come later; not core).
- Turn-by-turn navigation during the run.
- Supporting circuits or cities beyond what is bundled (until the roadmap frees
  the map).
