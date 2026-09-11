// A routable graph built once, client-side, from the bundled Porto street
// ways. porto-streets.json's ways were Douglas–Peucker–simplified
// independently per way (see src/data/porto-streets.schema.md), so two ways
// that share a real OSM junction are not guaranteed to share an exact vertex
// after simplification. Construction repairs connectivity by tolerance
// instead of touching the bundled data: nearby way endpoints merge into one
// node, and a still-unmatched endpoint that lands near another way's interior
// splits that way and creates a node there. See
// docs/specs/phase-7-street-graph.md.
import type { Point } from './geometry/types'
import { pathLength } from './geometry/path'
import { distance } from './geometry/vector'
import type { Street } from './streets'

export type NodeId = number

/** Endpoints within this distance of each other merge into one node. */
export const NODE_MERGE_M = 4

/** Grid cell size for the post-build node/edge nearest-point indices. */
const INDEX_CELL_M = 50

export type StreetGraph = {
  nodeCount: number
  nodePosition(id: NodeId): Point
  /** Nearest node within maxM, or null. */
  nearestNode(p: Point, maxM: number): NodeId | null
  /**
   * Nearest point anywhere on the network (a node or a point along an edge)
   * within maxM: the resolved node to route from/to, the point's exact
   * position (for snapping the waypoint marker), and the distance. Null if
   * nothing is in range.
   */
  nearestPointM(p: Point, maxM: number): { node: NodeId; point: Point; distanceM: number } | null
  /** Real shortest path by length, or null if `from`/`to` are disconnected. */
  shortestPath(from: NodeId, to: NodeId): { lengthM: number; points: Point[] } | null
}

type EdgeRecord = { a: NodeId; b: NodeId; points: Point[]; lengthM: number }

class UnionFind {
  private readonly parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!
      x = this.parent[x]!
    }
    return x
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

/** Foot of the perpendicular projection of `p` onto segment a-b, clamped to
 * the segment, with its parameter along the segment (0 at a, 1 at b). */
function projectOntoSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { point: a, t: 0 }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { point: [a[0] + t * dx, a[1] + t * dy], t }
}

/** A uniform grid over single points, for tolerance-radius nearest queries. */
function buildPointGrid(cellM: number): {
  insert(id: number, p: Point): void
  near(p: Point, maxM: number): number[]
} {
  const cells = new Map<string, number[]>()
  const key = (cx: number, cy: number): string => `${cx},${cy}`
  return {
    insert(id, p) {
      const k = key(Math.floor(p[0] / cellM), Math.floor(p[1] / cellM))
      const bucket = cells.get(k)
      if (bucket) bucket.push(id)
      else cells.set(k, [id])
    },
    near(p, maxM) {
      const out: number[] = []
      const cx0 = Math.floor((p[0] - maxM) / cellM)
      const cx1 = Math.floor((p[0] + maxM) / cellM)
      const cy0 = Math.floor((p[1] - maxM) / cellM)
      const cy1 = Math.floor((p[1] + maxM) / cellM)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const bucket = cells.get(key(cx, cy))
          if (bucket) out.push(...bucket)
        }
      }
      return out
    },
  }
}

/**
 * A uniform grid over segments (each inserted into every cell its bounding
 * box touches, same pattern as `buildStreetIndex`), returning candidate
 * indices into `segments` for a tolerance-radius query.
 */
function buildSegmentGrid(
  segments: ReadonlyArray<{ a: Point; b: Point }>,
  cellM: number,
): { near(p: Point, maxM: number): number[] } {
  const cells = new Map<string, number[]>()
  const key = (cx: number, cy: number): string => `${cx},${cy}`
  for (let idx = 0; idx < segments.length; idx++) {
    const { a, b } = segments[idx]!
    const minX = Math.min(a[0], b[0])
    const maxX = Math.max(a[0], b[0])
    const minY = Math.min(a[1], b[1])
    const maxY = Math.max(a[1], b[1])
    for (let cx = Math.floor(minX / cellM); cx <= Math.floor(maxX / cellM); cx++) {
      for (let cy = Math.floor(minY / cellM); cy <= Math.floor(maxY / cellM); cy++) {
        const k = key(cx, cy)
        const bucket = cells.get(k)
        if (bucket) bucket.push(idx)
        else cells.set(k, [idx])
      }
    }
  }
  return {
    near(p, maxM) {
      const out: number[] = []
      const cx0 = Math.floor((p[0] - maxM) / cellM)
      const cx1 = Math.floor((p[0] + maxM) / cellM)
      const cy0 = Math.floor((p[1] - maxM) / cellM)
      const cy1 = Math.floor((p[1] + maxM) / cellM)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const bucket = cells.get(key(cx, cy))
          if (bucket) out.push(...bucket)
        }
      }
      return out
    },
  }
}

type GraphCore = {
  nodePositions: Point[]
  edges: EdgeRecord[]
  adjacency: Map<NodeId, Array<{ to: NodeId; edgeIndex: number; forward: boolean }>>
}

/**
 * Node/edge/adjacency construction, shared by `buildStreetGraph` and
 * `componentLengthsM` (the latter needs the raw edge list to measure
 * connectivity and would otherwise have to redo this work from scratch).
 */
function buildGraphCore(ways: readonly Street[], nodeMergeM: number): GraphCore {
  // --- Pass 1: merge way endpoints within nodeMergeM of each other ---------
  type EndpointRef = { way: number; end: 0 | 1 }
  const endpoints: EndpointRef[] = []
  for (let w = 0; w < ways.length; w++) {
    endpoints.push({ way: w, end: 0 })
    endpoints.push({ way: w, end: 1 })
  }
  const endpointPoint = (ref: EndpointRef): Point => {
    const way = ways[ref.way]!
    return ref.end === 0 ? way[0]! : way[way.length - 1]!
  }

  const uf = new UnionFind(endpoints.length)
  const endpointGrid = buildPointGrid(Math.max(nodeMergeM, 1))
  for (let i = 0; i < endpoints.length; i++) {
    const p = endpointPoint(endpoints[i]!)
    for (const j of endpointGrid.near(p, nodeMergeM)) {
      if (distance(p, endpointPoint(endpoints[j]!)) <= nodeMergeM) uf.union(i, j)
    }
    endpointGrid.insert(i, p)
  }

  const clusters = new Map<number, number[]>() // cluster root -> endpoint indices
  for (let i = 0; i < endpoints.length; i++) {
    const root = uf.find(i)
    const list = clusters.get(root)
    if (list) list.push(i)
    else clusters.set(root, [i])
  }

  // --- Pass 2: a still-singleton endpoint splits another way's interior ----
  type Split = { way: number; seg: number; t: number; point: Point; clusterRoot: number }
  const allSegments: Array<{ way: number; seg: number; a: Point; b: Point }> = []
  for (let w = 0; w < ways.length; w++) {
    const pts = ways[w]!
    for (let i = 1; i < pts.length; i++) {
      allSegments.push({ way: w, seg: i, a: pts[i - 1]!, b: pts[i]! })
    }
  }
  const segGrid = buildSegmentGrid(allSegments, INDEX_CELL_M)

  const splits: Split[] = []
  for (const [root, members] of clusters) {
    if (members.length !== 1) continue
    const ref = endpoints[members[0]!]!
    const p = endpointPoint(ref)
    let best: { d: number; point: Point; segIdx: number } | null = null
    for (const segIdx of segGrid.near(p, nodeMergeM)) {
      const s = allSegments[segIdx]!
      if (s.way === ref.way) continue // another way's interior only
      const { point } = projectOntoSegment(p, s.a, s.b)
      const d = distance(p, point)
      if (d <= nodeMergeM && (!best || d < best.d)) best = { d, point, segIdx }
    }
    if (best) {
      const s = allSegments[best.segIdx]!
      const { t } = projectOntoSegment(p, s.a, s.b)
      splits.push({ way: s.way, seg: s.seg, t, point: best.point, clusterRoot: root })
    }
  }

  const splitByRoot = new Map<number, Split>()
  for (const s of splits) splitByRoot.set(s.clusterRoot, s)

  function clusterPosition(root: number): Point {
    const split = splitByRoot.get(root)
    if (split) return split.point
    const members = clusters.get(root)!
    let sx = 0
    let sy = 0
    for (const idx of members) {
      const p = endpointPoint(endpoints[idx]!)
      sx += p[0]
      sy += p[1]
    }
    return [sx / members.length, sy / members.length]
  }

  // --- Assign global node ids, walk each way to build edges ----------------
  const nodeIdOfRoot = new Map<number, NodeId>()
  const nodePositions: Point[] = []
  function nodeIdFor(root: number): NodeId {
    let id = nodeIdOfRoot.get(root)
    if (id === undefined) {
      id = nodePositions.length
      nodeIdOfRoot.set(root, id)
      nodePositions.push(clusterPosition(root))
    }
    return id
  }

  const splitsByWay = new Map<number, Split[]>()
  for (const s of splits) {
    const list = splitsByWay.get(s.way)
    if (list) list.push(s)
    else splitsByWay.set(s.way, [s])
  }
  for (const list of splitsByWay.values()) list.sort((a, b) => a.seg - b.seg || a.t - b.t)

  const edges: EdgeRecord[] = []
  const adjacency = new Map<NodeId, Array<{ to: NodeId; edgeIndex: number; forward: boolean }>>()
  function addAdjacency(node: NodeId, entry: { to: NodeId; edgeIndex: number; forward: boolean }): void {
    const list = adjacency.get(node)
    if (list) list.push(entry)
    else adjacency.set(node, [entry])
  }

  for (let w = 0; w < ways.length; w++) {
    const pts = ways[w]!
    const startRoot = uf.find(2 * w)
    const endRoot = uf.find(2 * w + 1)
    const waySplits = splitsByWay.get(w) ?? []

    const verts: Array<{ point: Point; nodeRoot: number | null }> = [
      { point: pts[0]!, nodeRoot: startRoot },
    ]
    let si = 0
    for (let i = 1; i < pts.length; i++) {
      while (si < waySplits.length && waySplits[si]!.seg === i) {
        verts.push({ point: waySplits[si]!.point, nodeRoot: waySplits[si]!.clusterRoot })
        si++
      }
      verts.push({ point: pts[i]!, nodeRoot: i === pts.length - 1 ? endRoot : null })
    }

    const nodeIndices: number[] = []
    for (let i = 0; i < verts.length; i++) if (verts[i]!.nodeRoot !== null) nodeIndices.push(i)

    for (let k = 0; k < nodeIndices.length - 1; k++) {
      const i0 = nodeIndices[k]!
      const i1 = nodeIndices[k + 1]!
      const segPoints = verts.slice(i0, i1 + 1).map((v) => v.point)
      const nodeA = nodeIdFor(verts[i0]!.nodeRoot!)
      const nodeB = nodeIdFor(verts[i1]!.nodeRoot!)
      const lengthM = pathLength(segPoints, false)
      const edgeIndex = edges.length
      edges.push({ a: nodeA, b: nodeB, points: segPoints, lengthM })
      addAdjacency(nodeA, { to: nodeB, edgeIndex, forward: true })
      addAdjacency(nodeB, { to: nodeA, edgeIndex, forward: false })
    }
  }

  return { nodePositions, edges, adjacency }
}

/** Build once from the decoded, projected ways (same input as buildStreetIndex). */
export function buildStreetGraph(
  ways: readonly Street[],
  opts?: { nodeMergeM?: number },
): StreetGraph {
  const { nodePositions, edges, adjacency } = buildGraphCore(ways, opts?.nodeMergeM ?? NODE_MERGE_M)

  // Cumulative arc length at each vertex of every edge, for nearestPointM.
  const edgeCumLength: number[][] = edges.map((e) => {
    const cum = [0]
    for (let i = 1; i < e.points.length; i++) {
      cum.push(cum[i - 1]! + distance(e.points[i - 1]!, e.points[i]!))
    }
    return cum
  })

  // --- Post-build indices for nearestNode / nearestPointM ------------------
  const nodeGrid = buildPointGrid(INDEX_CELL_M)
  nodePositions.forEach((p, id) => nodeGrid.insert(id, p))

  type EdgeSeg = { edgeIndex: number; segIdx: number; a: Point; b: Point }
  const edgeSegments: EdgeSeg[] = []
  edges.forEach((e, ei) => {
    for (let i = 1; i < e.points.length; i++) {
      edgeSegments.push({ edgeIndex: ei, segIdx: i, a: e.points[i - 1]!, b: e.points[i]! })
    }
  })
  const edgeSegGrid = buildSegmentGrid(edgeSegments, INDEX_CELL_M)

  /**
   * A `near(p, r)` box query returns every candidate within Euclidean
   * distance `r` (the box always contains the full circle), so the true
   * minimum among candidates with distance <= r is the true global nearest —
   * nothing outside the box can be closer than something already found
   * inside it. That lets a caller search a *small* radius first and only grow
   * it on a miss, instead of scanning a box sized by the caller's (possibly
   * huge, "any point on the network") maxM up front.
   */
  function expandingSearch<T>(
    near: (p: Point, r: number) => Iterable<T>,
    distanceOf: (candidate: T) => number,
    p: Point,
    maxM: number,
  ): T | null {
    let r = Math.min(maxM, INDEX_CELL_M)
    while (true) {
      let best: { candidate: T; d: number } | null = null
      for (const candidate of near(p, r)) {
        const d = distanceOf(candidate)
        if (d <= r && (!best || d < best.d)) best = { candidate, d }
      }
      if (best) return best.candidate
      if (r >= maxM) return null
      r = Math.min(maxM, r * 4)
    }
  }

  function nearestNode(p: Point, maxM: number): NodeId | null {
    return expandingSearch(
      (q, r) => nodeGrid.near(q, r),
      (id) => distance(p, nodePositions[id]!),
      p,
      maxM,
    )
  }

  function nearestPointM(p: Point, maxM: number): { node: NodeId; point: Point; distanceM: number } | null {
    type Candidate = { point: Point; edgeIndex: number; segIdx: number; t: number; d: number }
    const found = expandingSearch<Candidate>(
      (q, r) => {
        const out: Candidate[] = []
        for (const idx of edgeSegGrid.near(q, r)) {
          const s = edgeSegments[idx]!
          const { point, t } = projectOntoSegment(p, s.a, s.b)
          out.push({ point, edgeIndex: s.edgeIndex, segIdx: s.segIdx, t, d: distance(p, point) })
        }
        return out
      },
      (c) => c.d,
      p,
      maxM,
    )
    if (!found) return null
    const edge = edges[found.edgeIndex]!
    const cum = edgeCumLength[found.edgeIndex]!
    const segLen = distance(edge.points[found.segIdx - 1]!, edge.points[found.segIdx]!)
    const arcToFoot = cum[found.segIdx - 1]! + found.t * segLen
    const node = arcToFoot <= edge.lengthM - arcToFoot ? edge.a : edge.b
    return { node, point: found.point, distanceM: found.d }
  }

  function shortestPath(from: NodeId, to: NodeId): { lengthM: number; points: Point[] } | null {
    if (from === to) return { lengthM: 0, points: [nodePositions[from]!] }
    const target = nodePositions[to]!
    const gScore = new Map<NodeId, number>([[from, 0]])
    const cameFrom = new Map<NodeId, { via: NodeId; edgeIndex: number; forward: boolean }>()
    const open: Array<{ node: NodeId; f: number }> = [
      { node: from, f: distance(nodePositions[from]!, target) },
    ]
    const closed = new Set<NodeId>()

    while (open.length > 0) {
      const current = open.shift()!.node
      if (current === to) break
      if (closed.has(current)) continue
      closed.add(current)
      for (const edge of adjacency.get(current) ?? []) {
        if (closed.has(edge.to)) continue
        const tentativeG = gScore.get(current)! + edges[edge.edgeIndex]!.lengthM
        if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
          gScore.set(edge.to, tentativeG)
          cameFrom.set(edge.to, { via: current, edgeIndex: edge.edgeIndex, forward: edge.forward })
          const f = tentativeG + distance(nodePositions[edge.to]!, target)
          let lo = 0
          let hi = open.length
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (open[mid]!.f <= f) lo = mid + 1
            else hi = mid
          }
          open.splice(lo, 0, { node: edge.to, f })
        }
      }
    }

    if (!cameFrom.has(to)) return null

    const edgeChain: Array<{ edgeIndex: number; forward: boolean }> = []
    let node = to
    while (node !== from) {
      const c = cameFrom.get(node)!
      edgeChain.push({ edgeIndex: c.edgeIndex, forward: c.forward })
      node = c.via
    }
    edgeChain.reverse()

    const points: Point[] = [nodePositions[from]!]
    for (const { edgeIndex, forward } of edgeChain) {
      const pts = edges[edgeIndex]!.points
      const seq = forward ? pts : [...pts].reverse()
      for (let i = 1; i < seq.length; i++) points.push(seq[i]!)
    }
    return { lengthM: gScore.get(to)!, points }
  }

  return {
    nodeCount: nodePositions.length,
    nodePosition: (id) => nodePositions[id]!,
    nearestNode,
    nearestPointM,
    shortestPath,
  }
}

/**
 * Each connected component's total edge length (m), largest first. Exported
 * for the real-data connectivity test, which needs the graph's own edge list
 * to measure how much of the network one component reaches after
 * tolerance-based connectivity repair — not part of the app's routing path.
 */
export function componentLengthsM(ways: readonly Street[], opts?: { nodeMergeM?: number }): number[] {
  const { nodePositions, edges } = buildGraphCore(ways, opts?.nodeMergeM ?? NODE_MERGE_M)
  const parent = Array.from({ length: nodePositions.length }, (_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  for (const e of edges) {
    const ra = find(e.a)
    const rb = find(e.b)
    if (ra !== rb) parent[ra] = rb
  }
  const totals = new Map<number, number>()
  for (const e of edges) {
    const root = find(e.a)
    totals.set(root, (totals.get(root) ?? 0) + e.lengthM)
  }
  return [...totals.values()].sort((a, b) => b - a)
}
