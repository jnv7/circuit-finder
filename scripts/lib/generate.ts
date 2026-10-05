// Stage 2, called by `generate-route` (Phase 22, moved here in Phase 24,
// regionalised in Phase 26; `find-route` also called this until Phase 27
// split it into `extract-circuit` + `generate-route`): run the offline route
// generator for one circuit against each requested region and write one
// combined `src/data/routes/<circuitId>.json`. Nothing here runs in the
// browser. See docs/specs/phase-22-route-generator.md,
// docs/specs/phase-26-regional-search.md and
// docs/specs/phase-27-split-extraction-and-search-cli.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toMetric } from '../../src/circuits'
import type { Circuit } from '../../src/circuits'
import { pathLength, resample } from '../../src/geometry/path'
import { buildStreetGraph } from '../../src/graph'
import type { RegionId } from '../../src/regions'
import { generateRoutesForCircuit } from '../../src/route/escalate'
import { DEFAULT_BAR } from '../../src/route/metrics'
import { buildOrientationLayers } from '../../src/route/raster'
import { validateRouteFile } from '../../src/routes'
import type { RouteEntry, RouteFile } from '../../src/routes'
import { loadRegionStreetNetwork } from './regionNetworks'

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

/** Run the generator for one circuit against one region. */
function generateForRegion(
  regionId: RegionId,
  circuit: Circuit,
  scale: number,
  log: (msg: string) => void,
): { routes: RouteEntry[]; poses: number; escalationTier: number; streetsAttribution: RouteFile['streets'] } {
  const tag = `[${regionId}]`
  const metric = toMetric(circuit)
  const circuitSamplesM = resample(metric.metricCentreline, 5, true)
  const ringPerimeterM = pathLength(metric.metricCentreline, true)

  log(`${tag} loading street network...`)
  let t = Date.now()
  const { network, project } = loadRegionStreetNetwork(regionId)
  log(`${tag} street network loaded in ${elapsed(t)}, ${network.ways.length} ways`)

  log(`${tag} building routable graph...`)
  t = Date.now()
  const graph = buildStreetGraph(network.ways)
  log(`${tag} graph built in ${elapsed(t)}, ${graph.nodeCount} nodes`)

  log(`${tag} rasterising orientation layers...`)
  t = Date.now()
  const layers = buildOrientationLayers(network.ways)
  log(`${tag} raster built in ${elapsed(t)}`)

  const bounds = {
    min: project.toLocal([network.bbox[0], network.bbox[1]]),
    max: project.toLocal([network.bbox[2], network.bbox[3]]),
  }

  log(`${tag} generating routes (escalation ladder)...`)
  t = Date.now()
  const result = generateRoutesForCircuit(
    circuitSamplesM,
    ringPerimeterM,
    metric.lengthM,
    scale,
    bounds,
    layers,
    graph,
    { onTierRun: (tier) => log(`${tag} tier ${tier} finished after ${elapsed(t)}`) },
  )
  log(
    `${tag} generation finished in ${elapsed(t)} — escalationTier=${result.escalationTier}, ` +
      `${result.routes.length} route(s) kept`,
  )

  const routes: RouteEntry[] = result.routes.map((r, i) => {
    // `r.points` is a closed loop represented as an open polyline whose last
    // point repeats the first (routeDeviation's own convention, see
    // metrics.ts) — the stored format drops that repeat (circuits.json's own
    // convention: an open ring, first point not repeated).
    const openRing = r.points.slice(0, -1)
    return {
      region: regionId,
      rank: i + 1,
      passesBar: r.passesBar,
      pose: {
        anchor: project.toLonLat(r.pose.anchorM).map((v) => round(v, LON_LAT_DECIMALS)) as [number, number],
        rotationRad: r.pose.rotationRad,
      },
      points: openRing.map((p) => project.toLonLat(p).map((v) => round(v, LON_LAT_DECIMALS)) as [number, number]),
      metrics: r.metrics,
    }
  })

  return {
    routes,
    poses: result.posesSearched,
    escalationTier: result.escalationTier,
    streetsAttribution: network.attribution,
  }
}

/**
 * Generate and write the routes of `circuitId` against every region in
 * `regionIds`, which must be in `circuits` (passed in, not re-read from the
 * bundle, so a circuit added a moment ago by `extract-circuit` is visible).
 * Returns the combined file it wrote — or, with `dryRun`, would have
 * written: nothing under `src/data/routes/` is touched (Phase 27, after a
 * live verification run overwrote a real circuit's in-progress route file —
 * a real CLI run against real committed data must never be treated as a
 * cheap, safe check; this flag is what makes a real run safe instead).
 */
export function generateAndWriteRoute(
  circuits: readonly Circuit[],
  circuitId: string,
  scale: number,
  regionIds: readonly RegionId[],
  log: (msg: string) => void,
  dryRun = false,
): { file: RouteFile; path: string } {
  const circuit = circuits.find((c) => c.id === circuitId)
  if (!circuit) {
    throw new Error(`Unknown circuit id "${circuitId}". Known ids: ${circuits.map((c) => c.id).join(', ')}`)
  }
  if (regionIds.length === 0) throw new Error('generateAndWriteRoute: regionIds must not be empty')

  const regions: RouteFile['regions'] = []
  const routes: RouteEntry[] = []
  let streetsAttribution: RouteFile['streets'] | undefined

  for (const regionId of regionIds) {
    const result = generateForRegion(regionId, circuit, scale, log)
    regions.push({ id: regionId, poses: result.poses, escalationTier: result.escalationTier })
    routes.push(...result.routes)
    // Same OSM/ODbL attribution regardless of region; keep the first one.
    streetsAttribution ??= result.streetsAttribution
  }

  const routeFile: RouteFile = {
    schemaVersion: 2,
    circuitId,
    generatedAt: new Date().toISOString().slice(0, 10),
    scale,
    generator: { bar: DEFAULT_BAR },
    regions,
    streets: streetsAttribution!,
    routes,
  }

  // Sanity check before writing — a generator bug should fail loudly here,
  // not produce a file that only fails later, in routes.test.ts.
  validateRouteFile(routeFile, circuits.map((c) => c.id))

  const outDir = path.join(__dirname, '../../src/data/routes')
  const outPath = path.join(outDir, `${circuitId}.json`)
  if (dryRun) {
    log(`dry run: ${outPath} not written.`)
    return { file: routeFile, path: outPath }
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(routeFile, null, 2)}\n`)
  log(`wrote ${outPath}`)
  return { file: routeFile, path: outPath }
}
