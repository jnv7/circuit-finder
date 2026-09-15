# Spec — Phase 21: Avoid skeleton backtracking (local repair pass)

Status: `rejected` — **prototyped 2026-09-15, does not work as designed; not
implemented.** See the outcome note immediately below and the ROADMAP
decision log for the full finding.
Depends on: [phase-20-detect-skeleton-backtracking.md](phase-20-detect-skeleton-backtracking.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md)

> **Outcome (2026-09-15): the recommended approach below was prototyped
> exactly as written and does not work — not "didn't help on these three
> circuits," but *structurally cannot ever change anything*.** The
> landmark's own currently-resolved point always lies on an edge that
> belongs to one of its own two touching legs (that's what "resolved"
> means: the edge nearest its expected position, which necessarily becomes
> part of the route to/from its neighbours). The repair pass's exclusion
> set is explicitly "every edge used by legs *other than* the two touching
> this landmark" — so the landmark's current edge is, by construction,
> never in the excluded set. A plain nearest-match search
> (`nearestAlignedPointM`) with that point still eligible always re-finds
> that exact same point, since it was already the global nearest match
> before any exclusion was applied. Confirmed empirically across every
> landmark of hungaroring's and catalunya's top candidates (19 landmarks,
> including catalunya's flagged non-adjacent 2↔6 overlap): every single
> exclusion-aware search returned the landmark's existing node, at distance
> exactly 0. Measured on all three bundled circuits' worst candidates with
> a real implementation (added, measured, then removed — not merged):
> `retracedM` was bit-for-bit unchanged (hungaroring 1434 m, silverstone
> 361 m, catalunya 860 m, all before = after). No code from this
> prototype shipped — see the ROADMAP decision log entry dated 2026-09-15
> for the reasoning and what a viable next attempt would need to look like.
>
> The rest of this document is kept as the historical record of what was
> proposed and why it seemed promising before being measured.

## Goal

Phase 20 quantifies and displays backtracking; a user still has to notice
and manually drag every implicated landmark. For hungaroring's top candidate
that's potentially several drags in a row (every leg pair overlaps). This
phase asks whether the tool can fix the easy majority of that automatically,
leaving genuinely necessary human judgement calls (VISION's own principle)
for the cases that actually need it.

## Recommended approach (to validate, not to implement as-is)

After building a skeleton (Phase 14) and computing per-landmark `retraceM`
(Phase 20), for each landmark with `retraceM > 0`, attempt a **local
re-resolution**: search again within `LANDMARK_SEARCH_RADIUS_M` for the
best-aligned real street point, but this time **excluding edges already used
by the loop's other legs** (not the two touching this landmark — those get
rebuilt once it moves). If a real alternative exists that clears the same
alignment/coverage bar without those edges, move the landmark there — the
same primitive `moveLandmark` already performs for a manual drag, just
triggered automatically instead of by a mouse event. If no such alternative
exists within range, leave the landmark exactly where it is — Phase 20's
honest flag stays up, and that becomes a real, informed drag for the user
to make (or accept), never a forced worse placement just to hide the number.

Run this as a bounded number of passes (e.g. up to 3) over the whole
skeleton, since moving one landmark can change which *other* legs newly
overlap — stop early once a pass makes no further change, not always running
the full budget.

## Why this needs validation before it's a real spec

- **`StreetGraph` has no "search excluding these edge ids" primitive today.**
  `nearestAlignedPointM` would need a new parameter, or a new sibling
  function — real new surface area on `graph.ts`, not a trivial addition,
  and worth getting the shape right against real failure cases rather than
  guessing it up front.
- **It might not actually help.** If the underlying reason a landmark
  retraces is that its *only* nearby well-aligned street is the one causing
  the overlap (plausible in a dense, regular grid like Aldoar/Boavista,
  where "parallel options" may all connect back through the same few cross
  streets), exclusion search could just fail every time, or degrade
  alignment/coverage chasing an alternative that doesn't really exist —
  exactly the kind of "knob that measurably doesn't work" this project's own
  history (the 2026-09-14 cross-circuit investigation) found for three other
  ideas before landing on one that did. This one needs the same treatment:
  measure first.
- **The bounded-passes convergence behaviour needs checking on real data** —
  does 3 passes settle, or does fixing landmark A sometimes un-fix landmark
  B in a loop that never converges? A real prototype against hungaroring's
  10-corner, fully-overlapping case will show this quickly; reasoning about
  it in the abstract won't.

## What a validated spec should include, once prototyping answers the above

- The exact `StreetGraph` API addition (new function vs. a parameter on the
  existing one).
- Real before/after `retracedM` numbers for all three bundled circuits'
  worst candidates, and confirmation `meanDeviationM`/`coverageFraction`
  don't regress materially.
- The pass-count/convergence behaviour actually observed, not assumed.
- Whether this should run automatically every time a skeleton is built, or
  be an explicit opt-in action (VISION's "opt-in, advisory" pattern every
  automatic feature in this app already follows) — worth deciding with real
  numbers in hand, not in the abstract.

## Not in scope (regardless of how the prototype turns out)

- **Any change to Phase 6/12/15's placement search** — this is entirely
  about fixing up a skeleton after a placement is already chosen.
- **A joint global optimisation over all landmarks at once** — the bounded,
  local, one-landmark-at-a-time repair above is the starting hypothesis
  specifically because it's cheap to validate and reuses `moveLandmark`
  as-is; a full joint solve is a much bigger, riskier idea to reach for only
  if the local version demonstrably isn't enough.
