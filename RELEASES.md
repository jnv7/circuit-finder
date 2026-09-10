# Release notes

What each release lets you **do**, **see**, or **look up**. Written for the
person using circuit-finder, not for contributors — for the engineering log see
the decision log in [docs/ROADMAP.md](docs/ROADMAP.md).

Newest release first.

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
