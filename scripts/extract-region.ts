// Phase 26 (regional search, draft): dev-only CLI that fetches a region's
// "runnable" street network from Overpass and writes it in the same shape as
// `src/data/porto-streets.json` (see docs/specs/phase-26-regional-search.md,
// decision A). Nothing here runs in the browser.
//
//   npm run extract-region -- <regionId> --bbox west,south,east,north [--out path] [--offline]
//
// The bbox today is passed by hand (e.g. from an Overpass "out bb;" query on
// the concelho's administrative boundary relation) — the spec's open
// question of fetching the exact admin polygon instead of a padded bbox is
// not resolved here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { validateAttribution } from '../src/attribution'
import { createJsonClient } from '../src/extract/http'
import { buildRegionHighwayQuery, OVERPASS_ENDPOINTS, parseWays } from '../src/extract/overpass'
import { buildStreetNetworkFile } from '../src/extract/streetNetwork'
import { validateStreetNetwork } from '../src/streets'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(root, '.cache/extract-region')
const USER_AGENT = 'circuit-finder-extract-region/0.1 (dev tool, Phase 26 draft; +https://github.com/jnv7/circuit-finder)'
const FETCH_TIMEOUT_MS = 150_000

const USAGE = `Usage: npm run extract-region -- <regionId> --bbox west,south,east,north [flags]

  --bbox w,s,e,n   region bbox, decimal degrees (required)
  --out path       output file (default: src/data/regions/<regionId>-streets.json)
  --offline        use the response cache only`

function fail(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      bbox: { type: 'string' },
      out: { type: 'string' },
      offline: { type: 'boolean' },
    },
  })
  const regionId = positionals[0]
  if (!regionId) fail(USAGE)
  if (!values.bbox) fail(USAGE)
  const bbox = values.bbox.split(',').map(Number)
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) fail('--bbox must be four comma-separated numbers')
  const [west, south, east, north] = bbox as [number, number, number, number]

  const outPath = values.out ?? path.join(root, `src/data/regions/${regionId}-streets.json`)

  const cache = {
    get: (key: string): string | undefined => {
      const file = path.join(CACHE_DIR, `${key}.json`)
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined
    },
    put: (key: string, value: string): void => {
      mkdirSync(CACHE_DIR, { recursive: true })
      writeFileSync(path.join(CACHE_DIR, `${key}.json`), value)
    },
  }
  const getJson = createJsonClient({
    userAgent: USER_AGENT,
    offline: values.offline ?? false,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cache,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  })

  console.log(`[${regionId}] querying Overpass for bbox [${west}, ${south}, ${east}, ${north}]...`)
  const t0 = Date.now()
  const query = buildRegionHighwayQuery([west, south, east, north])
  const json = await getJson({ urls: OVERPASS_ENDPOINTS, body: `data=${encodeURIComponent(query)}` })
  const osmWays = parseWays(json)
  console.log(`[${regionId}] fetched ${osmWays.length} ways in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const attribution = validateAttribution(
    {
      source: 'OpenStreetMap contributors',
      license: 'ODbL 1.0',
      url: 'https://www.openstreetmap.org/copyright',
      retrieved: new Date().toISOString().slice(0, 10),
    },
    'extract-region',
  )

  const file = buildStreetNetworkFile(osmWays, [west, south, east, north], attribution)
  // Self-check before writing, same discipline as generate-route's routeFile check.
  const { ways } = validateStreetNetwork(file)
  const vertices = ways.reduce((n, w) => n + w.length, 0)
  console.log(`[${regionId}] ${file.ways.length} ways, ${vertices} vertices after clip/simplify`)

  const text = `${JSON.stringify(file, null, 2)}\n`
  writeAtomic(outPath, text)
  console.log(`[${regionId}] wrote ${outPath} (${(text.length / 1024).toFixed(1)} KB)`)
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)))
