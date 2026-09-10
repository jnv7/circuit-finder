# Release notes

What each release lets you **do**, **see**, or **look up**. Written for the
person using circuit-finder, not for contributors — for the engineering log see
the decision log in [docs/ROADMAP.md](docs/ROADMAP.md).

Newest release first.

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
