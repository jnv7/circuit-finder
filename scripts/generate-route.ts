// Phase 22: dev-only CLI that runs the offline route generator for one
// bundled circuit and writes `src/data/routes/<circuitId>.json`. Nothing here
// runs in the browser — this is the "by hand, once per circuit" step the
// spec calls for. Usage:
//
//   npm run generate-route -- <circuitId> [--scale N] [--region id ...]
//
// `--region` may be repeated to search a subset; omitted, all 5 regions in
// src/regions.ts are searched (Phase 26). The work itself lives in
// scripts/lib/generate.ts (shared with `find-route`). See
// docs/specs/phase-22-route-generator.md and
// docs/specs/phase-26-regional-search.md.
import { loadCircuits } from '../src/circuits'
import { isRegionId, REGION_IDS } from '../src/regions'
import type { RegionId } from '../src/regions'
import { generateAndWriteRoute } from './lib/generate'

const USAGE = 'Usage: npm run generate-route -- <circuitId> [--scale N] [--region id ...]'

function parseArgs(argv: readonly string[]): { circuitId: string; scale: number; regionIds: RegionId[] } {
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
  return { circuitId, scale, regionIds: regionIds.length > 0 ? regionIds : [...REGION_IDS] }
}

function main(): void {
  const { circuitId, scale, regionIds } = parseArgs(process.argv.slice(2))
  try {
    generateAndWriteRoute(loadCircuits(), circuitId, scale, regionIds, (msg) => console.log(`[${circuitId}] ${msg}`))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
