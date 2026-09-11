# Spec — Phase 7: Routable street graph & routed tracing

Status: `todo`
Depends on: [phase-3-street-proximity.md](phase-3-street-proximity.md),
[phase-5-trace-and-study.md](phase-5-trace-and-study.md)
See: [../VISION.md](../VISION.md), [../ROADMAP.md](../ROADMAP.md),
[../../CONVENTIONS.md](../../CONVENTIONS.md)

## Goal

Every street-aware feature so far is **geometry-only**: Phase 3's proximity
colouring and Phase 6's suggested placements both ask "is there a street near
this point, running this way?" — never "can I actually get from A to B along
streets?". Phase 5's tracing is worse: clicks are joined by straight lines, so
a traced "route" can cut through a block even while it looks like it follows
the overlay.

This phase builds a **routable graph** from the already-bundled Porto street
data and puts it to one concrete use: **tracing snaps to the network**. Every
click resolves to the nearest street point, and consecutive clicks are joined
by the real shortest path along streets — not a straight line. The traced
route becomes something you could actually run, always.

**Finding a closed loop shaped like the circuit** (a graph search for a real
found-loop match, replacing Phase 6's geometry-only suggestions with routed
ones) is **deliberately not in this phase** — see *Not in scope*. Phase 6
already ships a "starting point" workflow; teaching the graph to search for
whole loops is a materially harder, separate problem that deserves its own
spec once this phase's graph has proven itself for routing. Landing a thin,
useful slice now (real routing for tracing) beats a broad, unfinished one.

## How it stays true to the vision

- **"Trace the actual running route along real streets, following the
  overlay"** (a VISION.md goal, verbatim) — until now this was aspirational;
  free-click tracing could not guarantee it. This phase makes it literally
  true: a traced waypoint is always a point on the network, and the path
  between two waypoints is always a real path along it.
- **Real scale by default.** Route length becomes the length of the actual
  streets run, not a straight-line proxy between clicks — more accurate, same
  "metres are metres" principle.
- **Judgement stays with the user; no automated match score.** Routing answers
  "what's the real path from here to there", not "how good is this circuit
  attempt" — it adds no score. The mean/max deviation figures (Phase 5) keep
  their plain, descriptive character.
- **Static and offline.** The graph is built once, client-side, from the
  already-bundled `porto-streets.json` — no new data file, no server-side
  routing, no new dependency (Dijkstra/A* is straightforward to hand-write and
  keeps the "minimal dependencies" rule).

## Vocabulary

- **Node** — a point in the routable graph: a street endpoint, a real
  intersection, or a point where one street's endpoint meets another's middle
  (a T-junction). Distinct nodes are always more than `NODE_MERGE_M` apart.
- **Edge** — a routable connection between two adjacent nodes along one
  street, carrying its own interior shape points (for length and rendering) —
  not every original vertex becomes a node, only junctions and endpoints do.
- **Graph** — the whole node/edge structure built once, offline, from the
  bundled ways.
- **Waypoint** — a point the user clicked while tracing, snapped to the
  network. `AppState.route` stays the ordered list of waypoints (same shape as
  Phase 5); nothing about its persisted format changes.
- **Routed path** — the full point sequence a `shortestPath` query returns
  between two nodes; concatenating the routed path between each consecutive
  pair of waypoints gives the polyline actually drawn and measured.

## Decisions locked for this phase

- **Build the graph from the existing bundled data, at runtime.** No new data
  file, no re-run of the OSM extraction pipeline. `src/graph.ts` builds a
  `StreetGraph` from `StreetNetwork.ways` once on load, next to the existing
  `buildStreetIndex` call.
- **Connectivity is repaired by tolerance, not exact-coordinate matching.**
  `porto-streets.json`'s ways were Douglas–Peucker–simplified **independently
  per way** (see `porto-streets.schema.md`), so two ways that share a real OSM
  junction are not guaranteed to share an exact vertex after simplification —
  one side may have had that vertex simplified away. Graph construction:
  1. Collect every way's **endpoints** (first/last vertex) as junction
     candidates; merge candidates within `NODE_MERGE_M` of each other into one
     node (handles ways that meet end-to-end, the common case).
  2. For any endpoint still unmerged, search for the nearest point on
     **another way's interior segment** within `NODE_MERGE_M`; if found, split
     that way there (insert a vertex, turning one edge into two) and register
     a node at the split (handles a side street T-ing into a through street).
  3. An endpoint that matches neither becomes a legitimate degree-1 dead end
     (streets that end at a park, the coastline, or the bundled bbox edge).
  4. Interior vertices used by only one way and not a split point are **not**
     nodes — they stay as an edge's shape points. This keeps the graph small
     (junction-count nodes, not vertex-count).
  Real crossings with no shared vertex at all (a rare simplification artefact,
  or a genuine grade separation) are not connected — a known limitation, not a
  bug; the acceptance criteria include a real-data connectivity check to keep
  it honest.
- **Routing = A\*** (`shortestPath(from, to)`), edge weight = real length in
  metres, Euclidean straight-line heuristic (admissible and consistent for a
  metric embedding — every edge is at least as long as the straight line
  between its ends). No preference among runnable street types; the data
  pipeline already filtered to runnable `highway` tags.
- **Trace mode snaps, inside the bundled bbox.** A click resolves to the
  nearest node **or point on an edge** within `SNAP_MAX_M`; if none exists
  (click too far from any street) the click is **ignored** — no point is
  added, nothing crashes, the user just clicks again closer to a street. A
  click **outside the bundled bbox** (no street data there at all) falls back
  to Phase 5's old free straight-line behaviour, matching Phase 3's existing
  "outside the bbox, no feedback" precedent — never a hard error.
- **`AppState.route` keeps its Phase 5 shape**: an ordered list of waypoints
  (`LonLat[]`), now always network points. `addRoutePoint` / `undoRoutePoint`
  / `clearRoute` keep their signatures; only what a click resolves *to*
  changes, in `app/map.ts`. The routed polyline between waypoints is derived,
  not stored — recomputed from the (static, bundled) graph, the same
  recompute-don't-persist pattern Phase 3/4 already use for proximity.
  `SavedPlacement`'s `route` field and `PLACEMENTS_SCHEMA_VERSION` are
  unchanged.
- **Length and deviation now measure the routed path.** `app/trace.ts`'s
  `routeLengthM` / `routeDeviation` take the *expanded* polyline (waypoints
  routed through the graph), not the raw waypoints — the length shown is the
  real distance of streets run, and deviation compares that real path against
  the placed circuit centreline. If any consecutive waypoint pair is
  unreachable (disconnected components), expansion falls back to a straight
  line for just that pair and the stats still compute — advisory, never
  blocking.
- **Tests:** `graph.ts` is pure with full unit + `fast-check` coverage
  (synthetic T-junctions, shared endpoints, dangling ends, disconnected
  components) plus a real-data test reporting the largest connected
  component's share of total network length. `trace.ts`'s expansion is pure
  and unit-tested. The map glue keeps its jsdom smoke tests, extended to
  "click near a street twice while tracing → drawn route hugs the streets, not
  a straight line" and "click far from any street → ignored".

## Repository layout after this phase

```text
src/
├── graph.ts                    # NEW buildStreetGraph, StreetGraph (pure)
├── graph.test.ts
├── app/
│   ├── trace.ts                 # + expandRoute (routes waypoints through the graph)
│   ├── trace.test.ts            # extended
│   ├── map.ts                   # wire snap-on-click + routed rendering
│   └── map.test.ts              # extended
```

`streets.ts`, `app/state.ts`, `app/proximity.ts`, `ui/controls.ts`,
`placements.ts` are unchanged. No new data file, no new dependency.

## New / changed code

### `graph.ts` (pure)

```ts
export type NodeId = number

export type StreetGraph = {
  nodeCount: number
  nodePosition(id: NodeId): Point
  /** Nearest node within maxM, or null. */
  nearestNode(p: Point, maxM: number): NodeId | null
  /**
   * Nearest point *anywhere on the network* (a node or a point along an edge)
   * within maxM: the resolved node to route from/to, its exact position (for
   * snapping the waypoint marker), and the distance. Null if nothing is in
   * range.
   */
  nearestPointM(p: Point, maxM: number): { node: NodeId; point: Point; distanceM: number } | null
  /** Real shortest path by length, or null if `from`/`to` are disconnected. */
  shortestPath(from: NodeId, to: NodeId): { lengthM: number; points: Point[] } | null
}

/** Build once from the decoded, projected ways (same input as buildStreetIndex). */
export function buildStreetGraph(ways: readonly Street[], opts?: { nodeMergeM?: number }): StreetGraph
```

Construction (internal, not exported): grid-bucket merge of way endpoints
(`NODE_MERGE_M`), then a segment-interior split pass reusing the same
`closestPointOnSegment` grid-scan pattern as `buildStreetIndex`, then edges
built by walking each way between its resolved node positions. Adjacency is a
plain `Map<NodeId, Array<{ to: NodeId; edgeIndex: number }>>`; `shortestPath`
is A* with a binary-heap-free priority queue (a sorted-insert array is plenty
at this graph size — no new dependency).

### `app/trace.ts`

```ts
/**
 * The full point sequence actually run: waypoints joined by their real
 * shortest path through `graph`. Falls back to a straight line for any
 * consecutive pair the graph can't connect (advisory, never throws).
 */
export function expandRoute(waypoints: readonly Point[], graph: StreetGraph): Point[]
```

`routeLengthM` / `routeDeviation` / `routeStats` take the expanded polyline —
callers (`app/map.ts`) pass `expandRoute(...)` instead of the raw route.

### `app/map.ts` (glue)

- Build `streetGraph = buildStreetGraph(network.ways)` once on load, next to
  `streetIndex`.
- `onMapClick` while tracing: resolve `graph.nearestPointM([lng,lat] in Porto
  metres, SNAP_MAX_M)`; inside the bbox and nothing in range → ignore the
  click; outside the bbox → keep today's raw `[lng, lat]`; otherwise
  `addRoutePoint(state, project.toLonLat(resolved.point))`.
- `render()`: draw `routeLine` from `expandRoute(state.route in metres,
  streetGraph)` (projected back to lat/lng), not the raw waypoints; vertex
  markers still mark the waypoints only.
- `currentRouteStats()`: pass the expanded polyline into `routeStats`.

## Constants

| name | value | meaning |
| --- | --- | --- |
| `NODE_MERGE_M` | `4` | endpoints within this distance merge into one node |
| `SNAP_MAX_M` | `30` | a click within this distance of the network snaps to it |

## Tests

All offline, default vitest environment except the jsdom smoke test.

- **`graph`**: two ways sharing an exact endpoint merge to one node and two
  edges; a way whose endpoint lands mid-segment of another way splits that way
  into two edges and creates a node there; an isolated way with no shared
  points yields two degree-1 dead-end nodes and one edge; `shortestPath` on a
  synthetic 3-street T-junction finds the two-edge path and its length is the
  sum of the edges'; `shortestPath` returns `null` for two nodes in
  disconnected components; `fast-check`: for a random simple polygon turned
  into one way, `shortestPath` between any two of its own vertices never
  exceeds the polygon's perimeter.
- **`graph` (real data, may be marked slow)**: built from the real
  `porto-streets.json`, report the largest connected component's share of
  total network length in the ROADMAP entry; assert it clears a floor (exact
  number set once measured — a materially-connected network, not a field of
  fragments).
- **`app/trace` `expandRoute`**: three waypoints on a synthetic graph produce
  the concatenation of the two routed legs (no duplicated join point); a
  waypoint pair in disconnected components falls back to the straight line
  between them and still returns a usable polyline; `routeLengthM` on the
  expanded output is the sum of real edge lengths, not the straight-line
  waypoint distance.
- **`app/map` (jsdom)**: clicking twice near real streets while tracing draws
  a route whose point count is larger than 2 (it followed the network, not a
  straight line) and whose rendered path differs from the straight join;
  clicking far from any street inside the bbox does not add a route point or
  change `routePointCount`; clicking outside the bbox still behaves like
  Phase 5 (falls back to the raw point).

## Acceptance criteria

- `npm run dev`: with **Trace route** on, clicking near two different streets
  draws a route that visibly follows the streets between them, not a straight
  line; the panel's route length reflects that real distance.
- Clicking somewhere with no nearby street (inside the bundled area) does
  nothing — no crash, no stray point.
- Outside the bundled Porto area, tracing still works exactly as it did in
  Phase 5 (free straight-line clicks) — never a hard error.
- `npm run test:run` and `npm run build` pass; the real-data connectivity
  figure is reported in the ROADMAP decision-log entry.
- No new dependency, no new data file, no change to `SavedPlacement`'s stored
  shape or `PLACEMENTS_SCHEMA_VERSION`.

## Not in scope

- **Finding a closed street loop shaped like the circuit.** A graph search for
  a runnable loop matching the circuit's outline (and re-scoring or replacing
  Phase 6's geometry-only suggestions with a routed turning-function /
  Procrustes comparison on the found loop) is a separate, materially harder
  problem — a later item once this phase's graph and routing are proven.
- **Re-simplifying or re-fetching the bundled street data.** Connectivity gaps
  from the independent-per-way Douglas–Peucker pass are repaired at runtime by
  tolerance, not by changing `porto-streets.json` or its extraction pipeline.
- **Extending coverage beyond the bundled Porto bbox**, or any Overpass call
  at runtime.
- **Editing an existing traced route** (dragging a waypoint, inserting a
  point mid-route) — add / undo / clear stays the whole edit surface, as in
  Phase 5.
- **Routing preferences** (avoid unlit streets, prefer footways over
  service roads, etc.) — every already-bundled runnable street type is treated
  equally.
