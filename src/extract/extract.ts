// Stage 1 of `find-route` (Phase 24): from a circuit's name to a validated
// `Circuit`, ready to append to `circuits.json`. Pure apart from the injected
// `getJson`; it never writes anything — `applyExtraction` is the one function
// that does, and only after validation passes.
import type { Circuit } from '../circuits'
import { validateCircuits } from '../circuits'
import type { LonLat } from '../geo'
import { projectRing } from '../geo'
import { pathLength } from '../geometry/path'
import { simplify } from '../geometry/simplify'
import { slugId } from './names'
import type { JsonRequest } from './http'
import { OVERPASS_ENDPOINTS, buildElementQuery, buildQuery, candidateWays, parseWays } from './overpass'
import type { OsmWay } from './overpass'
import { collapseEquivalent, findRings, pickRing, rankRings } from './rings'
import type { RankedRing } from './rings'
import { RACETRACK_CLASSES, entitiesUrl, parseEntities, parseSearch, searchUrl } from './wikidata'
import type { TrackEntity } from './wikidata'

/** Douglas–Peucker tolerance; matches the documented pipeline the bundled circuits came from. */
export const SIMPLIFY_TOLERANCE_M = 2.5
/** Overpass search radius (half-side of the box) around the Wikidata coordinate. */
export const DEFAULT_RADIUS_M = 3500
/** A closest ring this far off suggests the lap is not (fully) tagged as raceway at all. */
const STREET_CIRCUIT_HINT_ERROR = 0.5
const LON_LAT_DECIMALS = 6
const LOCATION_DECIMALS = 4

export type ExtractDeps = {
  getJson(request: JsonRequest): Promise<unknown>
  /** Today, as YYYY-MM-DD (the attribution's `retrieved`). */
  today(): string
  log(message: string): void
}

export type ExtractOptions = {
  wikidata?: string
  relation?: number
  way?: number
  excludeWays?: number[]
  officialLengthM?: number
  radiusM?: number
  id?: string
  name?: string
  lat?: number
  lon?: number
  /** Print candidates and stop: nothing is assembled. */
  list?: boolean
}

export type Provenance = {
  /** The OSM element the ring came from, as a URL. */
  url: string
  wayIds: number[]
  wikidataId?: string
  computedLengthM: number
  officialLengthM: number
  points: number
  /** Things worth knowing about how the ring was chosen (tie-break, bridged gaps). */
  notes: string[]
}

export type ExtractResult =
  | { kind: 'extracted'; circuit: Circuit; provenance: Provenance }
  | { kind: 'listed' }
  | { kind: 'refused'; code: 'no-entity' | 'ambiguous-entity' | 'no-ring' | 'ambiguous-ring'; message: string }

const round = (n: number, decimals: number): number => {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

const describeEntity = (e: TrackEntity): string =>
  `${e.id}  ${e.label}${e.description ? ` — ${e.description}` : ''}  (${Math.round(e.lengthM)} m)`

const describeRing = (r: RankedRing, official: number): string =>
  `${Math.round(r.lengthM)} m (${(r.errorRatio * 100).toFixed(1)}% off ${Math.round(official)} m), ` +
  `${r.wayIds.length} way(s) [${r.wayIds.slice(0, 8).join(', ')}${r.wayIds.length > 8 ? ', …' : ''}]` +
  `${r.allInRelation ? ', all relation members' : ''}${r.equivalentCount ? `, +${r.equivalentCount} equivalent` : ''}${r.bridgedGapsM.length ? `, ${r.bridgedGapsM.length} bridged gap(s)` : ''}`

/** Find the Wikidata racetrack a name refers to: exactly one, or a refusal that lists the candidates. */
async function resolveEntity(
  query: string,
  opts: ExtractOptions,
  deps: ExtractDeps,
): Promise<{ entity: TrackEntity } | { refusal: Extract<ExtractResult, { kind: 'refused' }> }> {
  if (opts.wikidata) {
    const json = await deps.getJson({ urls: [entitiesUrl([opts.wikidata])] })
    const [entity] = parseEntities(json, { anyClass: true })
    if (entity) return { entity }
    return {
      refusal: {
        kind: 'refused',
        code: 'no-entity',
        message: `${opts.wikidata} has no coordinate and lap length on Wikidata — pass --lat/--lon and --official-length-m`,
      },
    }
  }
  const ids: string[] = []
  for (const classId of RACETRACK_CLASSES) {
    for (const id of parseSearch(await deps.getJson({ urls: [searchUrl(query, classId)] }))) if (!ids.includes(id)) ids.push(id)
  }
  const candidates = ids.length === 0 ? [] : parseEntities(await deps.getJson({ urls: [entitiesUrl(ids.slice(0, 50))] }))
  if (candidates.length === 1) return { entity: candidates[0]! }
  if (candidates.length === 0) {
    return {
      refusal: {
        kind: 'refused',
        code: 'no-entity',
        message:
          `no motorsport racetrack named "${query}" with a coordinate and lap length was found on Wikidata. ` +
          'Pass --wikidata Q…, or --relation/--way with --official-length-m and --lat/--lon.',
      },
    }
  }
  return {
    refusal: {
      kind: 'refused',
      code: 'ambiguous-entity',
      message: `"${query}" matches several racetracks — pick one with --wikidata:\n  ${candidates.map(describeEntity).join('\n  ')}`,
    },
  }
}

function overpassRequest(query: string): JsonRequest {
  return { urls: OVERPASS_ENDPOINTS, body: `data=${encodeURIComponent(query)}` }
}

/** The OSM element an extraction should be credited to. */
function sourceUrl(ways: readonly OsmWay[], ring: RankedRing, relationOverride?: number): string {
  if (relationOverride !== undefined) return `https://www.openstreetmap.org/relation/${relationOverride}`
  const byId = new Map(ways.map((w) => [w.id, w]))
  const relations = new Set(ring.wayIds.map((id) => byId.get(id)?.relationId))
  const only = relations.size === 1 ? [...relations][0] : undefined
  if (only !== undefined) return `https://www.openstreetmap.org/relation/${only}`
  return `https://www.openstreetmap.org/way/${ring.wayIds[0]}`
}

/**
 * Stage 1. Never throws for "could not decide" — that is a `refused` result
 * with the candidates in its message. It does throw for genuine failures
 * (network exhausted, a graph too tangled to search, a circuit that fails
 * validation), and by then nothing has been written.
 */
export async function extractCircuit(
  query: string,
  existing: readonly Circuit[],
  opts: ExtractOptions,
  deps: ExtractDeps,
): Promise<ExtractResult> {
  // With a coordinate and a length supplied there is nothing to ask Wikidata for.
  let entity: TrackEntity | undefined
  if (opts.lat === undefined || opts.lon === undefined || opts.officialLengthM === undefined) {
    deps.log(`resolving "${query}" on Wikidata...`)
    const resolved = await resolveEntity(query, opts, deps)
    if ('refusal' in resolved) return resolved.refusal
    entity = resolved.entity
    deps.log(`  ${describeEntity(entity)}`)
  }

  const officialLengthM = opts.officialLengthM ?? entity?.lengthM
  const lat = opts.lat ?? entity?.lonLat[1]
  const lon = opts.lon ?? entity?.lonLat[0]
  if (officialLengthM === undefined || lat === undefined || lon === undefined) {
    throw new Error('need a coordinate and an official length (from Wikidata, or --lat/--lon/--official-length-m)')
  }
  const wikidataId = entity?.id ?? opts.wikidata

  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M
  const overpassQuery =
    opts.relation !== undefined
      ? buildElementQuery({ relation: opts.relation })
      : opts.way !== undefined
        ? buildElementQuery({ way: opts.way })
        : buildQuery({ lat, lon, radiusM }, wikidataId)
  deps.log('fetching track ways from OpenStreetMap...')
  const ways = parseWays(await deps.getJson(overpassRequest(overpassQuery)))
  const candidates = candidateWays(ways, opts.excludeWays)
  deps.log(`  ${ways.length} raceway way(s), ${candidates.length} after dropping pit lanes/exclusions`)

  const rings = findRings(candidates)
  const ranked = rankRings(rings, officialLengthM)
  deps.log(`  ${rings.length} closed ring(s); closest to ${Math.round(officialLengthM)} m:`)
  for (const r of collapseEquivalent(ranked).slice(0, 5)) deps.log(`    ${describeRing(r, officialLengthM)}`)
  if (opts.list) return { kind: 'listed' }

  const pick = pickRing(ranked)
  if (pick.kind === 'none') {
    const streetHint =
      ranked.length === 0 || ranked[0]!.errorRatio > STREET_CIRCUIT_HINT_ERROR
        ? ' A street circuit is usually mapped as ordinary streets rather than highway=raceway, and stitching those is not supported: name the lap by hand with --relation/--way.'
        : ''
    return {
      kind: 'refused',
      code: 'no-ring',
      message: `no lap chosen: ${pick.reason}.${streetHint} Otherwise pin the source with --relation/--way or --exclude-ways, or correct --official-length-m.`,
    }
  }
  if (pick.kind === 'ambiguous') {
    return {
      kind: 'refused',
      code: 'ambiguous-ring',
      message:
        'several rings match the official length equally well; refusing to guess. Candidates:\n  ' +
        pick.top.map((r) => describeRing(r, officialLengthM)).join('\n  ') +
        '\nPin one with --way/--relation, or drop the others with --exclude-ways.',
    }
  }

  const { ring } = pick
  const { points: metric, projection } = projectRing(ring.points)
  const simplified = simplify(metric, SIMPLIFY_TOLERANCE_M, true)
  const centreline: LonLat[] = simplified
    .map((p) => projection.toLonLat(p))
    .map(([x, y]) => [round(x, LON_LAT_DECIMALS), round(y, LON_LAT_DECIMALS)] as LonLat)
    .filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1])

  const name = opts.name ?? entity?.label ?? query
  const url = sourceUrl(ways, ring, opts.relation)
  const circuit: Circuit = {
    id: opts.id ?? slugId(name),
    name,
    location: { lat: round(lat, LOCATION_DECIMALS), lon: round(lon, LOCATION_DECIMALS) },
    officialLengthM: Math.round(officialLengthM),
    attribution: { source: 'OpenStreetMap contributors', license: 'ODbL 1.0', url, retrieved: deps.today() },
    centreline,
  }
  // Fail here, before anything can be written, if the result is not a valid circuit list.
  validateCircuits([...existing, circuit])

  const notes: string[] = []
  if (pick.note) notes.push(pick.note)
  if (ring.bridgedGapsM.length > 0) {
    notes.push(`bridged ${ring.bridgedGapsM.length} gap(s) between ways sharing no node: ${ring.bridgedGapsM.map((g) => `${g} m`).join(', ')}`)
  }
  return {
    kind: 'extracted',
    circuit,
    provenance: {
      url,
      wayIds: ring.wayIds,
      ...(wikidataId ? { wikidataId } : {}),
      computedLengthM: Math.round(pathLength(projectRing(centreline).points, true)),
      officialLengthM: circuit.officialLengthM,
      points: centreline.length,
      notes,
    },
  }
}

/** `circuits.json` text: two-space JSON with each coordinate pair on one line, as the file is kept. */
export function formatCircuits(circuits: readonly Circuit[]): string {
  const entry = (c: Circuit): string =>
    [
      '  {',
      `    "id": ${JSON.stringify(c.id)},`,
      `    "name": ${JSON.stringify(c.name)},`,
      `    "location": { "lat": ${c.location.lat}, "lon": ${c.location.lon} },`,
      `    "officialLengthM": ${c.officialLengthM},`,
      '    "attribution": {',
      `      "source": ${JSON.stringify(c.attribution.source)},`,
      `      "license": ${JSON.stringify(c.attribution.license)},`,
      `      "url": ${JSON.stringify(c.attribution.url)},`,
      `      "retrieved": ${JSON.stringify(c.attribution.retrieved)}`,
      '    },',
      '    "centreline": [',
      c.centreline.map(([lon, lat]) => `      [${lon}, ${lat}]`).join(',\n'),
      '    ]',
      '  }',
    ].join('\n')
  return `[\n${circuits.map(entry).join(',\n')}\n]\n`
}

/**
 * The only place stage 1 writes. Validates the whole resulting list first and
 * calls `write` only if that passes; a refusal or a validation failure leaves
 * whatever `write` would have replaced untouched.
 */
export function applyExtraction(
  existing: readonly Circuit[],
  result: ExtractResult,
  write: (circuitsJson: string) => void,
): Circuit[] {
  if (result.kind !== 'extracted') return [...existing]
  const next = validateCircuits([...existing.filter((c) => c.id !== result.circuit.id), result.circuit])
  write(formatCircuits(next))
  return next
}

/** The row to paste into `circuits.schema.md`'s provenance table (kept a deliberate human step). */
export function provenanceRow(circuit: Circuit, p: Provenance): string {
  const source = `[${p.url.replace('https://www.openstreetmap.org/', '').replace('/', ' ')}](${p.url})${
    p.wayIds.length > 1 ? ` (ways ${p.wayIds.join(' + ')})` : ''
  }`
  return `| \`${circuit.id}\` | ${circuit.name} | ${source} | <layout — fill in> | ${p.points} | ${p.computedLengthM} m / ${p.officialLengthM} m |`
}
