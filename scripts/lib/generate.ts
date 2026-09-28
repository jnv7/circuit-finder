// Stage 2 shared by `generate-route` and `find-route` (Phase 22, moved here in
// Phase 24 with no behaviour change): run the offline route generator for one
// circuit and write `src/data/routes/<circuitId>.json`. Nothing here runs in
// the browser. See docs/specs/phase-22-route-generator.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toMetric } from '../../src/circuits'
import type { Circuit } from '../../src/circuits'
import { pathLength, resample } from '../../src/geometry/path'
import { buildStreetGraph } from '../../src/graph'
import { portoProjection } from '../../src/porto'
import { generateRoutesForCircuit } from '../../src/route/escalate'
import { DEFAULT_BAR } from '../../src/route/metrics'
import { buildOrientationLayers } from '../../src/route/raster'
import { validateRouteFile } from '../../src/routes'
import type { RouteFile } from '../../src/routes'
import { loadStreetNetwork } from '../../src/streets'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LON_LAT_DECIMALS = 6

function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** "11.7 min (702.1s)": minutes first, the exact seconds in parentheses. */
export function formatDuration(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min (${(ms / 1000).toFixed(1)}s)`
}

function elapsed(startMs: number): string {
  return formatDuration(Date.now() - startMs)
}

/**
 * Generate and write the routes of `circuitId`, which must be in `circuits`
 * (passed in, not re-read from the bundle, so a circuit added a moment ago by
 * `find-route` is visible). Returns the file it wrote.
 */
export function generateAndWriteRoute(
  circuits: readonly Circuit[],
  circuitId: string,
  scale: number,
  log: (msg: string) => void,
): { file: RouteFile; path: string } {
  const circuit = circuits.find((c) => c.id === circuitId)
  if (!circuit) {
    throw new Error(`Unknown circuit id "${circuitId}". Known ids: ${circuits.map((c) => c.id).join(', ')}`)
  }

  const metric = toMetric(circuit)
  const circuitSamplesM = resample(metric.metricCentreline, 5, true)
  const ringPerimeterM = pathLength(metric.metricCentreline, true)

  log('loading street network...')
  let t = Date.now()
  const network = loadStreetNetwork()
  log(`street network loaded in ${elapsed(t)}, ${network.ways.length} ways`)

  log('building routable graph...')
  t = Date.now()
  const graph = buildStreetGraph(network.ways)
  log(`graph built in ${elapsed(t)}, ${graph.nodeCount} nodes`)

  log('rasterising orientation layers...')
  t = Date.now()
  const layers = buildOrientationLayers(network.ways)
  log(`raster built in ${elapsed(t)}`)

  const project = portoProjection()
  const bounds = {
    min: project.toLocal([network.bbox[0], network.bbox[1]]),
    max: project.toLocal([network.bbox[2], network.bbox[3]]),
  }

  log('generating routes (escalation ladder)...')
  t = Date.now()
  const result = generateRoutesForCircuit(
    circuitSamplesM,
    ringPerimeterM,
    metric.lengthM,
    scale,
    bounds,
    layers,
    graph,
    { onTierRun: (tier) => log(`tier ${tier} finished after ${elapsed(t)}`) },
  )
  log(
    `generation finished in ${elapsed(t)} — escalationTier=${result.escalationTier}, ` +
      `${result.routes.length} route(s) kept`,
  )

  const routeFile: RouteFile = {
    schemaVersion: 1,
    circuitId,
    generatedAt: new Date().toISOString().slice(0, 10),
    scale,
    generator: {
      poses: result.posesSearched,
      escalationTier: result.escalationTier,
      bar: DEFAULT_BAR,
    },
    streets: network.attribution,
    routes: result.routes.map((r, i) => {
      // `r.points` is a closed loop represented as an open polyline whose
      // last point repeats the first (routeDeviation's own convention, see
      // metrics.ts) — the stored format drops that repeat (circuits.json's
      // own convention: an open ring, first point not repeated).
      const openRing = r.points.slice(0, -1)
      return {
        rank: i + 1,
        passesBar: r.passesBar,
        pose: {
          anchor: project.toLonLat(r.pose.anchorM).map((v) => round(v, LON_LAT_DECIMALS)) as [number, number],
          rotationRad: r.pose.rotationRad,
        },
        points: openRing.map((p) => project.toLonLat(p).map((v) => round(v, LON_LAT_DECIMALS)) as [number, number]),
        metrics: r.metrics,
      }
    }),
  }

  // Sanity check before writing — a generator bug should fail loudly here,
  // not produce a file that only fails later, in routes.test.ts.
  validateRouteFile(routeFile, circuits.map((c) => c.id))

  const outDir = path.join(__dirname, '../../src/data/routes')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${circuitId}.json`)
  writeFileSync(outPath, `${JSON.stringify(routeFile, null, 2)}\n`)
  log(`wrote ${outPath}`)
  return { file: routeFile, path: outPath }
}
