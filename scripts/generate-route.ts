// Phase 22: dev-only CLI that runs the offline route generator for one
// bundled circuit and writes `src/data/routes/<circuitId>.json`. Nothing here
// runs in the browser — this is the "by hand, once per circuit" step the
// spec calls for. Usage:
//
//   npm run generate-route -- <circuitId> [--scale N] [--region id ...] [--dry-run]
//
// `--region` may be repeated to search a subset; omitted, every region in
// src/regions.ts are searched (Phase 26). The circuit itself must already be
// in circuits.json — fetch it first with `extract-circuit` if it isn't
// (Phase 27). `--dry-run` runs the real (slow) search and prints the same
// summary, but never writes `src/data/routes/<circuitId>.json` — the only
// safe way to run this against real data to check something, e.g. by hand
// after a code change, without risking a real circuit's committed or
// in-progress route file (Phase 27, after a live verification run
// overwrote one for real). The work itself lives in scripts/lib/generate.ts.
// See docs/specs/phase-22-route-generator.md,
// docs/specs/phase-26-regional-search.md and
// docs/specs/phase-27-split-extraction-and-search-cli.md.
import { loadCircuits } from '../src/circuits'
import { barMisses } from '../src/app/barMisses'
import { isRegionId, REGION_IDS } from '../src/regions'
import type { RegionId } from '../src/regions'
import { formatDuration, generateAndWriteRoute } from './lib/generate'

const USAGE = 'Usage: npm run generate-route -- <circuitId> [--scale N] [--region id ...] [--dry-run]'

function parseArgs(argv: readonly string[]): { circuitId: string; scale: number; regionIds: RegionId[]; dryRun: boolean } {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const circuitId = positional[0]
  if (!circuitId) {
    console.error(USAGE)
    process.exit(1)
  }
  const scaleIdx = argv.indexOf('--scale')
  const scale = scaleIdx >= 0 ? Number(argv[scaleIdx + 1]) : 1
  if (!Number.isFinite(scale) || scale <= 0) {
    console.error('--scale must be a positive number')
    process.exit(1)
  }
  const dryRun = argv.includes('--dry-run')

  const regionIds: RegionId[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--region') continue
    const value = argv[i + 1]
    if (!isRegionId(value)) {
      console.error(`--region must be one of: ${REGION_IDS.join(', ')} (got "${value}")`)
      process.exit(1)
    }
    regionIds.push(value)
  }
  return { circuitId, scale, regionIds: regionIds.length > 0 ? regionIds : [...REGION_IDS], dryRun }
}

function main(): void {
  const { circuitId, scale, regionIds, dryRun } = parseArgs(process.argv.slice(2))
  const startMs = Date.now()
  try {
    const { file } = generateAndWriteRoute(loadCircuits(), circuitId, scale, regionIds, (msg) => console.log(`[${circuitId}] ${msg}`), dryRun)
    console.log(`\n${file.routes.length} route(s) for ${circuitId} across ${file.regions.length} region(s):`)
    for (const region of file.regions) {
      console.log(`  ${region.id}: escalation tier ${region.escalationTier}, ${region.poses} poses searched`)
      for (const r of file.routes.filter((route) => route.region === region.id)) {
        const m = r.metrics
        const misses = barMisses(m, file.generator.bar)
        console.log(
          `    #${r.rank}: ${m.lengthM.toFixed(0)} m (${m.lengthRatio.toFixed(2)}×), mean ${m.meanDeviationM.toFixed(1)} m, ` +
            `max ${m.maxDeviationM.toFixed(1)} m, retraced ${(m.retracedFraction * 100).toFixed(1)}% — ` +
            (misses.length === 0 ? 'meets the bar' : `misses the bar: ${misses.join('; ')}`),
        )
      }
    }
    console.log(`\ntotal: ${formatDuration(Date.now() - startMs)}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    console.error(`(after ${formatDuration(Date.now() - startMs)})`)
    process.exit(1)
  }
}

main()
