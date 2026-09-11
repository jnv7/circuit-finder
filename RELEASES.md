# Release notes

What each release lets you **do**, **see**, or **look up**. Written for the
person using circuit-finder, not for contributors — for the engineering log see
the decision log in [docs/ROADMAP.md](docs/ROADMAP.md).

Newest release first.

---

## 0.8.0 — Tracing follows the actual streets (2026-09-11)

**Your traced route now hugs real streets, not straight lines between clicks.**
Turn on **Trace route** and click near a street: the click snaps to it, and the
line to your next click follows the real street network the whole way —
around corners, down the block you actually meant — instead of cutting
straight through buildings.

**What changes for you:**

- Click anywhere within about 30 m of a street while tracing and it snaps
  there. Click somewhere with no street nearby and nothing happens — no stray
  point, just click again closer to a street.
- **Route length** and the **deviation** figures now measure the real routed
  distance — the streets you'd actually run — not the straight-line distance
  between your clicks.
- Outside the bundled Porto area (no street data there), tracing still works
  the old way: free clicks joined by straight lines.

Undo, clear, save, and Study view all work exactly as before — only what a
click resolves to, and what gets drawn and measured, changed.

---

## 0.7.1 — Street feedback that means something (2026-09-11)

**The green now means "you could run this", not "a street is nearby".** Until
now a stretch of the circuit lit up green whenever *any* street passed within
about 10 m — including one it merely crosses. So a shape could zig-zag between
buildings, clipping street after street, and still look like a great fit.

From this release a stretch only counts as on-street when there's a street
running **roughly the same direction** underneath it (within about 35°). Cut
across the blocks and that stretch goes red, the way it should.

**What changes for you:**

- The live **"Near a street: NN %"** figure and the outline colours are
  stricter. Placements you already saved will look redder where they cross
  streets rather than follow them — that's the more honest picture, not a
  regression.
- **Suggested placements** are now labelled with the *same* number you'll see on
  the map once you press **Use this** — no more "88 % in the list, 81 % on the
  map". The suggestions for the bundled circuits come out around 50–65 % on
  Porto streets: lower than before, but real. Porto's tangled streets just don't
  hold a perfect Formula 1 loop, and the tool no longer pretends otherwise.

It still can't guarantee the green stretches join up into one continuous
runnable loop — that needs a proper street network, which is on the roadmap.

---

## 0.7.0 — Let the tool suggest where to start (2026-09-10)

**Stop hunting for a starting spot by hand.** Pick a circuit and click
**Suggest placements**. The tool sweeps the whole Porto street map looking for
places where that circuit's shape would sit well on real streets, and offers you
the best few as a short ranked list.

**What you get:**

- A progress bar while it searches (it takes a few seconds), with a **Cancel**
  button if you change your mind.
- Up to five suggestions, each labelled the way you already know from the live
  feedback — **"NN % on streets"** — plus a rough **"~NN m avg"** for how far
  the shape sits from the streets under it. They're ordered, but there's no
  winner: picking the third is as fine as picking the first.
- **Hover a suggestion** to see its outline previewed on the map, dashed, without
  changing anything.
- **Use this** drops the circuit onto that spot and pans the map to it. It's a
  starting point, not an answer — the circuit stays fully draggable, so nudge
  and rotate it from there as usual. If you'd already traced a route, it asks
  first, because the route belonged to the old position.

The search only looks inside the bundled Porto area and never goes online.
Nothing is chosen for you and there's still no "match score" — the tool just
points at a few spots worth a look.

---

## 0.6.0 — Trace your route and study it (2026-09-10)

**Draw the run you'd actually do.** With a circuit placed over Porto, click
**Trace route** and then click your way along the streets underneath it. A blue
line follows your clicks. **Undo point** takes back the last click; **Clear
route** starts over. The circuit outline holds still while you trace.

**What the panel tells you:**

- **Route length** — how long your traced route really is, next to the circuit's
  own length at the current scale, with the difference as a percentage
  (e.g. "3.98 km — circuit 4.31 km, −8%").
- **Deviation** — roughly how far your route wanders from the circuit shape,
  as an average and a worst-point figure in metres ("~45 m avg · 160 m max").
  It's a description, not a score — there's no pass mark, you decide what's
  close enough. Moving, rotating or rescaling the circuit updates it live.

**Study view.** Once you have a route, **Study view** clears everything away —
panels, the circuit outline, the street shading — and leaves just the map and
your route with the two numbers. Good for a screenshot, or print the page from
your browser. **Exit study view** brings the tools back.

**It's saved with the placement.** Saving now stores your traced route too, so
reopening the app (or switching back to that circuit) brings the whole thing
back — placement and route. Reverting and deleting include the route as well.
Placements you saved before this release still load fine; they just have no
route yet.

---

## 0.5.0 — Save a placement and pick up where you left off (2026-09-10)

**Found a loop you like? Keep it.** Each circuit now remembers one placement.

**What you can do:**

- **Save placement** stores the current circuit exactly where you have it — its
  position, rotation and scale.
- **Reopen the app** (or switch back to that circuit from the picker) and it is
  right where you left it — the map even pans to it. No list to dig through: one
  saved placement per circuit.
- **Preview saved** — after you have nudged things around, tick this to see the
  saved version laid over the map as a dashed outline, so you can compare before
  deciding. Untick to go back to what you were doing.
- **Revert to saved** throws away the current changes and snaps back to the
  saved placement.
- **Delete saved** forgets it (after a confirmation), and **Save placement**
  over an existing one asks before replacing it.

Everything stays in your browser — nothing is uploaded, and there are no
accounts. If your browser blocks local storage (private windows, some
settings), the tool still works for the session; it just will not remember
between visits.

Moving a saved placement to another computer as a file is still to come.

---

## 0.4.0 — See where the circuit meets the streets (2026-09-10)

**The overlay now tells you how runnable a placement looks.** As you drag or
rotate a circuit over Porto, its outline recolours in real time:

- **green** where that stretch sits right on top of a real street,
- **amber** where it partly does,
- **red** where it cuts across a block with no street under it.

A small **legend** in the panel explains the colours.

**What you can see:**

- a live **"Near a street: NN %"** figure in the panel — roughly how much of the
  whole lap is running on real streets right now. It updates as you move, rotate,
  change circuit, or change the scale. It is just a hint: there is no score and
  nothing stops you placing the circuit wherever you like.
- a faint grey **street layer** over Porto, so you can see what the colouring is
  reacting to. Turn it off with the **"Show streets"** checkbox if it gets busy.

The street map is a bundled copy of OpenStreetMap data (ODbL), credited on the
map — nothing is downloaded while you use the tool. Feedback covers roughly
9 × 5 km: the whole city of Porto, from the Foz do Douro coast in the west
across to the eastern edge of town. Drag far outside that and the colouring
simply stops.

You still cannot save a placement — that is the next release.

---

## 0.3.0 — Put a circuit on the map (2026-09-10)

**The first interactive release.** circuit-finder now opens on a real map of
Porto with a Formula 1 circuit laid over it at true real-world scale — the
paper-acetate idea, on a live map.

**What you can do:**

- **Pick a circuit** (Hungaroring, Silverstone, or Catalunya) from the panel and
  see its centreline drawn on Porto at 1:1.
- **Drag it anywhere** on the map to reposition it, and **rotate it** with the
  round handle to line it up with streets you know.
- **Change the scale** with the multiplier (0.5× to 3×) if you want to explore a
  bigger or smaller loop — 1× is the real circuit size.

**What you can see:**

- a live readout of the **lap length** and the **longest straight** for the
  current scale, in km/m — moving or rotating the overlay never changes these,
  only the scale does;
- both data credits on the map: OpenStreetMap for the map tiles and for the
  circuit geometry (ODbL).

You cannot save a placement yet — that is the next release. The map also stays
fixed on Porto for now.

---

## 0.2.0 — Real circuits and their measurements (2026-09-10)

**See real Formula 1 circuit shapes and dimensions.** The circuit list now
carries actual track geometry, not placeholders. Three circuits are bundled:

- **Hungaroring**
- **Silverstone Circuit** (Grand Prix layout)
- **Circuit de Barcelona-Catalunya**

**Look up, for each circuit:**

- its **lap length**, measured from the real centreline, next to the officially
  published length;
- its **longest straight**, in metres.

For example, the app measures Silverstone's longest straight at about 760 m
(the Hangar Straight) and Catalunya's at about 1055 m (the pit straight).

**Check where the data comes from.** Every circuit's geometry is a normalised
copy of OpenStreetMap data, and the page shows the source and licence (ODbL).

Still no map in this release — that is the next one.

---

## 0.1.0 — First running skeleton (2026-09-09)

**Open the app and see it work end to end.** circuit-finder builds, runs
locally, and deploys as a static site with no backend.

**See the list of season circuits** the tool knows about, loaded from bundled
data.

Nothing is interactive yet: no map, no overlay, no saving. This release exists
to prove the foundation — build, tests, and deploy pipeline — is solid.
