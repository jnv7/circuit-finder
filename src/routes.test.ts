// Validates every committed `src/data/routes/*.json` file: structurally
// (`validateRouteFile`) and numerically — each route's stored metrics must
// recompute to the same numbers from its own `points`/`pose` against the
// circuit and the bundled graph, so a stale or hand-edited file fails here.
// Cheap (one metric evaluation per route, no search), so this runs in the
// default suite unlike the generator itself. See
// docs/specs/phase-22-route-generator.md.
import { describe, it, expect } from 'vitest'
import { routeDeviation } from './app/trace'
import { loadCircuits, toMetric } from './circuits'
import { pathLength } from './geometry/path'
import type { Point } from './geometry/types'
import { buildStreetGraph } from './graph'
import type { NodeId, StreetGraph } from './graph'
import { portoProjection } from './porto'
import { buildLoopFromNodes } from './route/mapMatch'
import { frechetToRing, retracedFraction as computeRetracedFraction } from './route/metrics'
import { placePoint } from './route/poseSearch'
import { loadStreetNetwork } from './streets'
import { validateRouteFile } from './routes'

const modules = import.meta.glob('./data/routes/*.json', { eager: true }) as Record<
  string,
  { default: unknown }
>
const files = Object.entries(modules).map(([path, mod]) => ({ path, data: mod.default }))

/**
 * Re-resolve a stored route's points back to the graph nodes they came from,
 * for `retracedFraction` only (the one metric that genuinely needs edge-level
 * graph info). `points` holds full edge geometry (every intermediate vertex
 * `shortestPath` walked), not just node positions, so this snaps each point
 * to its nearest network point and keeps the node it resolves to, collapsing
 * consecutive repeats. Every other metric is measured directly off the
 * stored points (pure geometry, no graph, no reconstruction) — rebuilding
 * the whole route via these re-snapped nodes would risk a shortest path that
 * diverges from the one actually stored wherever the snap is ambiguous (near
 * a junction, or two parallel streets), which is exactly what happened here
 * on first attempt (up to ~400 m off on a ~5 km route) despite the file being
 * perfectly correct.
 */
function reresolveNodeIds(closedRouteM: readonly Point[], graph: StreetGraph): NodeId[] {
  const ids: NodeId[] = []
  for (const p of closedRouteM.slice(0, -1)) {
    const resolved = graph.nearestPointM(p, 5)
    if (!resolved) throw new Error('stored route point does not resolve onto the bundled network')
    if (ids.length === 0 || ids[ids.length - 1] !== resolved.node) ids.push(resolved.node)
  }
  return ids
}

describe('committed route files', () => {
  const circuits = loadCircuits()
  const knownIds = circuits.map((c) => c.id)

  if (files.length === 0) {
    it('has no committed route files yet (nothing to validate)', () => {
      expect(files).toHaveLength(0)
    })
    return
  }

  const network = loadStreetNetwork()
  const graph = buildStreetGraph(network.ways)
  const project = portoProjection()

  for (const { path, data } of files) {
    describe(path, () => {
      it('validates against the schema', () => {
        expect(() => validateRouteFile(data, knownIds)).not.toThrow()
      })

      it('every route recomputes to its stored metrics', () => {
        const file = validateRouteFile(data, knownIds)
        const circuit = circuits.find((c) => c.id === file.circuitId)!
        const metric = toMetric(circuit)

        for (const route of file.routes) {
          const anchorM = project.toLocal(route.pose.anchor)
          const placedRingM = metric.metricCentreline.map((p) =>
            placePoint(p, { anchorM, rotationRad: route.pose.rotationRad }, file.scale),
          )
          const openRouteM = route.points.map((p) => project.toLocal(p))
          const closedRouteM = [...openRouteM, openRouteM[0]!]

          const lengthM = pathLength(closedRouteM, false)
          const { meanM, maxM } = routeDeviation(closedRouteM, placedRingM)
          const frechetM = frechetToRing(closedRouteM, placedRingM)
          const lengthRatio = metric.lengthM * file.scale === 0 ? 0 : lengthM / (metric.lengthM * file.scale)

          // Geometric metrics: only lon/lat rounding to 6 decimals separates
          // stored from recomputed, which on a several-km route accumulates
          // to a few metres, not sub-metre — `toBeCloseTo`'s digit-based
          // precision is the wrong shape of tolerance for a summed quantity
          // like this, so compare the absolute difference against a fixed,
          // generous-but-real metre budget instead (still far tighter than
          // the acceptance bar itself, so genuine staleness still fails loud).
          expect(Math.abs(lengthM - route.metrics.lengthM)).toBeLessThan(5)
          expect(Math.abs(lengthRatio - route.metrics.lengthRatio)).toBeLessThan(0.01)
          expect(Math.abs(meanM - route.metrics.meanDeviationM)).toBeLessThan(3)
          expect(Math.abs(maxM - route.metrics.maxDeviationM)).toBeLessThan(3)
          expect(Math.abs(frechetM - route.metrics.frechetM)).toBeLessThan(3)

          // Retraced fraction: the one metric that needs edge-level graph
          // info, re-derived by snapping (see `reresolveNodeIds`). That
          // snap is genuinely approximate — near a junction, or where two
          // streets run close and parallel, a point can resolve to a
          // slightly different node than the one the generator actually
          // walked, over- or under-counting edge reuse (measured on real
          // data: usually agrees to a few thousandths, occasionally off by
          // several hundredths on a route with tight parallel streets). A
          // wide but bounded absolute budget, generously above the bar's own
          // 0.05 (retrace) limit — a coarse staleness/corruption guard, not
          // an exact reproduction; the geometric metrics above already give
          // tight, exact-reproduction coverage.
          const nodeIds = reresolveNodeIds(closedRouteM, graph)
          const { legs } = buildLoopFromNodes(nodeIds, graph)
          const retraced = computeRetracedFraction(legs, graph, lengthM)
          expect(Math.abs(retraced - route.metrics.retracedFraction)).toBeLessThan(0.1)
        }
      })
    })
  }
})
