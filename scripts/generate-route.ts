// Phase 22: dev-only CLI that runs the offline route generator for one
// bundled circuit and writes `src/data/routes/<circuitId>.json`. Nothing here
// runs in the browser — this is the "by hand, once per circuit" step the
// spec calls for. Usage:
//
//   npm run generate-route -- <circuitId> [--scale N]
//
// The work itself lives in scripts/lib/generate.ts (shared with `find-route`).
// See docs/specs/phase-22-route-generator.md.
import { loadCircuits } from '../src/circuits'
import { generateAndWriteRoute } from './lib/generate'

function parseArgs(argv: readonly string[]): { circuitId: string; scale: number } {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const circuitId = positional[0]
  if (!circuitId) {
    console.error('Usage: npm run generate-route -- <circuitId> [--scale N]')
    process.exit(1)
  }
  const scaleIdx = argv.indexOf('--scale')
  const scale = scaleIdx >= 0 ? Number(argv[scaleIdx + 1]) : 1
  if (!Number.isFinite(scale) || scale <= 0) {
    console.error('--scale must be a positive number')
    process.exit(1)
  }
  return { circuitId, scale }
}

function main(): void {
  const { circuitId, scale } = parseArgs(process.argv.slice(2))
  try {
    generateAndWriteRoute(loadCircuits(), circuitId, scale, (msg) => console.log(`[${circuitId}] ${msg}`))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
