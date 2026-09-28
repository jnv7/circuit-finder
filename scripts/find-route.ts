// Phase 24: dev-only CLI from a circuit's name to its stored Porto route.
//
//   npm run find-route -- "Monza" [flags]
//
// Stage 1 finds the circuit (bundled, or fetched from Wikidata + OpenStreetMap
// and appended to src/data/circuits.json); stage 2 runs Phase 22's generator
// and writes src/data/routes/<id>.json. The network is used only by stage 1's
// one-time fetch; the shipped site never fetches anything. Deterministic and
// non-interactive: an ambiguity is a non-zero exit with the candidates printed.
// See docs/specs/phase-24-find-route-by-name.md.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { loadCircuits } from '../src/circuits'
import type { Circuit } from '../src/circuits'
import { barMisses } from '../src/app/barMisses'
import { applyExtraction, extractCircuit, provenanceRow } from '../src/extract/extract'
import type { ExtractOptions, ExtractResult } from '../src/extract/extract'
import { createJsonClient } from '../src/extract/http'
import { matchBundled } from '../src/extract/names'
import { generateAndWriteRoute } from './lib/generate'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CIRCUITS_PATH = path.join(root, 'src/data/circuits.json')
const CACHE_DIR = path.join(root, '.cache/find-route')
const USER_AGENT = 'circuit-finder-find-route/1.0 (dev tool; +https://github.com/jnv7/circuit-finder)'
const FETCH_TIMEOUT_MS = 90_000

const USAGE = `Usage: npm run find-route -- "<circuit name>" [flags]

  --list                 resolve and print candidates; write nothing
  --dry-run              run stage 1, print the circuit that would be added; write nothing, skip stage 2
  --extract-only         stage 1 only (writes circuits.json), skip stage 2
  --refresh              re-extract a circuit that is already bundled
  --wikidata Q…          pick the Wikidata entity (skips the name search)
  --relation N | --way N use this OSM element as the ring source
  --exclude-ways a,b,…   OSM way ids to drop before the ring search
  --official-length-m N  override the official lap length
  --radius-m N           Overpass search radius (default 3500)
  --id, --name           override the derived id / display name
  --lat, --lon           override the circuit's centre
  --scale N              scale passed to the route generator (default 1)
  --offline              use the response cache only`

function fail(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

function num(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) fail(`${flag} must be a number, got "${value}"`)
  return n
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

function circuitSummary(c: Circuit): string {
  return `${c.id} — ${c.name}, official ${c.officialLengthM} m, ${c.centreline.length} points, source ${c.attribution.url}`
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      list: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'extract-only': { type: 'boolean' },
      refresh: { type: 'boolean' },
      wikidata: { type: 'string' },
      relation: { type: 'string' },
      way: { type: 'string' },
      'exclude-ways': { type: 'string' },
      'official-length-m': { type: 'string' },
      'radius-m': { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      lat: { type: 'string' },
      lon: { type: 'string' },
      scale: { type: 'string' },
      offline: { type: 'boolean' },
    },
  })
  const query = positionals.join(' ').trim()
  if (query === '') fail(USAGE)
  const scale = num(values.scale, '--scale') ?? 1
  if (scale <= 0) fail('--scale must be a positive number')
  const log = (msg: string): void => console.log(msg)

  let circuits = loadCircuits()
  const matches = matchBundled(query, circuits)
  if (matches.length > 1) {
    fail(`"${query}" matches several bundled circuits — be more specific:\n  ${matches.map((c) => `${c.id} (${c.name})`).join('\n  ')}`, 2)
  }
  const bundled = matches[0]
  let circuitId: string

  if (bundled && !values.refresh && !values.list) {
    log(`"${query}" is already bundled: ${circuitSummary(bundled)}`)
    circuitId = bundled.id
  } else {
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

    const excludeWays = values['exclude-ways']?.split(',').map((s) => Number(s.trim()))
    if (excludeWays?.some((n) => !Number.isInteger(n))) fail('--exclude-ways must be a comma-separated list of OSM way ids')
    const relation = num(values.relation, '--relation')
    const way = num(values.way, '--way')
    if (relation !== undefined && way !== undefined) fail('pass --relation or --way, not both')
    const opts: ExtractOptions = {
      ...(values.wikidata ? { wikidata: values.wikidata } : {}),
      ...(relation !== undefined ? { relation } : {}),
      ...(way !== undefined ? { way } : {}),
      ...(excludeWays ? { excludeWays } : {}),
      ...(num(values['official-length-m'], '--official-length-m') !== undefined ? { officialLengthM: num(values['official-length-m'], '--official-length-m')! } : {}),
      ...(num(values['radius-m'], '--radius-m') !== undefined ? { radiusM: num(values['radius-m'], '--radius-m')! } : {}),
      ...(num(values.lat, '--lat') !== undefined ? { lat: num(values.lat, '--lat')! } : {}),
      ...(num(values.lon, '--lon') !== undefined ? { lon: num(values.lon, '--lon')! } : {}),
      ...(values.id ? { id: values.id } : {}),
      ...(values.name ? { name: values.name } : {}),
      ...(values.list ? { list: true } : {}),
    }
    // Refreshing a bundled circuit re-extracts it under its own id and name.
    let existing = circuits
    let searchName = query
    if (bundled && values.refresh) {
      existing = circuits.filter((c) => c.id !== bundled.id)
      searchName = bundled.name
      opts.id ??= bundled.id
      opts.name ??= bundled.name
    }

    let result: ExtractResult
    try {
      result = await extractCircuit(searchName, existing, opts, { getJson, today: () => new Date().toISOString().slice(0, 10), log })
    } catch (err) {
      fail(`stage 1 failed, nothing written: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (result.kind === 'listed') return
    if (result.kind === 'refused') fail(`\n${result.message}`, result.code === 'no-entity' ? 1 : 2)

    const { circuit, provenance } = result
    log(`\nextracted: ${circuitSummary(circuit)}`)
    log(`computed length ${provenance.computedLengthM} m vs official ${provenance.officialLengthM} m`)
    for (const note of provenance.notes) log(`note: ${note}`)
    log(`\nprovenance row for src/data/circuits.schema.md (paste by hand):\n${provenanceRow(circuit, provenance)}\n`)
    if (values['dry-run']) {
      log('dry run: nothing written.')
      return
    }
    circuits = applyExtraction(circuits, result, (json) => writeAtomic(CIRCUITS_PATH, json))
    log(`wrote ${CIRCUITS_PATH}`)
    circuitId = circuit.id
    if (values['extract-only']) return
  }

  if (values['dry-run'] || values.list) return
  const tag = `[${circuitId}]`
  try {
    const { file } = generateAndWriteRoute(circuits, circuitId, scale, (msg) => log(`${tag} ${msg}`))
    log(`\n${file.routes.length} route(s) for ${circuitId} (escalation tier ${file.generator.escalationTier}):`)
    for (const r of file.routes) {
      const m = r.metrics
      const misses = barMisses(m, file.generator.bar)
      log(
        `  #${r.rank}: ${m.lengthM.toFixed(0)} m (${m.lengthRatio.toFixed(2)}×), mean ${m.meanDeviationM.toFixed(1)} m, ` +
          `max ${m.maxDeviationM.toFixed(1)} m, retraced ${(m.retracedFraction * 100).toFixed(1)}% — ` +
          (misses.length === 0 ? 'meets the bar' : `misses the bar: ${misses.join('; ')}`),
      )
    }
  } catch (err) {
    console.error(`\nroute generation failed: ${err instanceof Error ? err.message : String(err)}`)
    fail(`The circuit stays in circuits.json. Resume with:\n  npm run generate-route -- ${circuitId}`)
  }
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)))
