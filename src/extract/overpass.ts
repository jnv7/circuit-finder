// Overpass query building and response parsing for `find-route` (Phase 24).
// Pure — the HTTP lives in http.ts / scripts/find-route.ts.
//
// The query is bounded twice, on purpose (found by probing the live service):
// a bare-name or planet-wide tag search times out, and even an `around` filter
// answered 504 where the equivalent bounding box answered in ~1 s. So ways are
// fetched by bbox, and the wikidata-tagged relation only among the relations
// that contain a raceway way found there.
import type { LonLat } from '../geo'

export type OsmWay = {
  id: number
  nodeIds: number[]
  /** [lon, lat] per node, aligned with `nodeIds`. */
  points: LonLat[]
  tags: Record<string, string>
  /** Role this way has in the wikidata-tagged relation, when it is a member. */
  role?: string
  /** True when the way is a member of the wikidata-tagged relation. */
  inRelation: boolean
  /** Id of that relation, when `inRelation`. */
  relationId?: number
}

/** Public Overpass endpoints: the primary, then the fallback mirror. */
export const OVERPASS_ENDPOINTS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const METRES_PER_DEG_LAT = 111_320

/**
 * Query for the raceway ways in a square around a point (the radius is the
 * half-side) and, when a Wikidata id is known, the relation carrying it.
 */
export function buildQuery(around: { lat: number; lon: number; radiusM: number }, wikidataId?: string): string {
  const { lat, lon, radiusM } = around
  const dLat = radiusM / METRES_PER_DEG_LAT
  const dLon = radiusM / (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',')
  if (wikidataId === undefined) {
    return [
      '[out:json][timeout:60];',
      `way["highway"="raceway"](${bbox})->.ways;`,
      '.ways out body;',
      '.ways >;',
      'out skel qt;',
    ].join('\n')
  }
  if (!/^Q\d+$/.test(wikidataId)) throw new Error(`not a Wikidata id: ${wikidataId}`)
  return [
    '[out:json][timeout:60];',
    `way["highway"="raceway"](${bbox})->.near;`,
    `rel(bw.near)["wikidata"="${wikidataId}"]->.rels;`,
    '(.near; way(r.rels);)->.ways;',
    '.rels out body;',
    '.ways out body;',
    '.ways >;',
    'out skel qt;',
  ].join('\n')
}

/** Query for one named OSM element as the ring source (`--relation` / `--way`). */
export function buildElementQuery(element: { relation: number } | { way: number }): string {
  if ('relation' in element) {
    if (!Number.isInteger(element.relation) || element.relation <= 0) throw new Error(`not an OSM id: ${element.relation}`)
    return [
      '[out:json][timeout:60];',
      `rel(${element.relation})->.rels;`,
      'way(r.rels)->.ways;',
      '.rels out body;',
      '.ways out body;',
      '.ways >;',
      'out skel qt;',
    ].join('\n')
  }
  if (!Number.isInteger(element.way) || element.way <= 0) throw new Error(`not an OSM id: ${element.way}`)
  return ['[out:json][timeout:60];', `way(${element.way})->.ways;`, '.ways out body;', '.ways >;', 'out skel qt;'].join('\n')
}

type OverpassElement = {
  type?: string
  id?: number
  nodes?: number[]
  lat?: number
  lon?: number
  tags?: Record<string, string>
  members?: Array<{ type?: string; ref?: number; role?: string }>
}

/**
 * Ways (with node coordinates) from an Overpass response, each annotated with
 * its role in a wikidata-matching relation when it is one of its members.
 * Throws when a way references a node the response does not contain.
 */
export function parseWays(json: unknown): OsmWay[] {
  const elements = (json as { elements?: unknown })?.elements
  if (!Array.isArray(elements)) throw new Error('Overpass response has no "elements" array')
  const nodes = new Map<number, LonLat>()
  const roles = new Map<number, string>()
  const relationOf = new Map<number, number>()
  for (const raw of elements as OverpassElement[]) {
    if (raw.type === 'node' && raw.id !== undefined && raw.lat !== undefined && raw.lon !== undefined) {
      nodes.set(raw.id, [raw.lon, raw.lat])
    } else if (raw.type === 'relation') {
      for (const m of raw.members ?? []) {
        if (m.type !== 'way' || m.ref === undefined) continue
        // A pit_lane role anywhere wins over an empty role elsewhere.
        if (m.role === 'pit_lane' || !roles.has(m.ref)) roles.set(m.ref, m.role ?? '')
        if (!relationOf.has(m.ref) && raw.id !== undefined) relationOf.set(m.ref, raw.id)
      }
    }
  }
  const ways: OsmWay[] = []
  for (const raw of elements as OverpassElement[]) {
    if (raw.type !== 'way' || raw.id === undefined || !Array.isArray(raw.nodes) || raw.nodes.length < 2) continue
    const points = raw.nodes.map((n) => {
      const p = nodes.get(n)
      if (!p) throw new Error(`way ${raw.id} references node ${n}, missing from the Overpass response`)
      return p
    })
    const role = roles.get(raw.id)
    ways.push({
      id: raw.id,
      nodeIds: raw.nodes,
      points,
      tags: raw.tags ?? {},
      ...(role ? { role } : {}),
      inRelation: roles.has(raw.id),
      ...(relationOf.has(raw.id) ? { relationId: relationOf.get(raw.id)! } : {}),
    })
  }
  return ways
}

// A pit lane by name: "Pit Lane", "Pitlane", "Pits", or a name that ends in "Pit"
// ("Stowe Circuit Pit"). Not "National Pit Straight" — Silverstone's start/finish
// straight, found by the 2026-09-28 reproduction check — nor "Spitzkehre".
const PIT_NAME = /pit[- ]?lane|pitlane|^pits?$|\bpit$/i

/** True for a way that is a pit lane by role, tag or name. */
export function isPitLane(way: OsmWay): boolean {
  return (
    way.role === 'pit_lane' ||
    way.tags['raceway'] === 'pit_lane' ||
    way.tags['service'] === 'pit_lane' ||
    PIT_NAME.test(way.tags['name'] ?? '')
  )
}

/** Ways left after dropping pit lanes and any explicitly excluded way ids. */
export function candidateWays(ways: readonly OsmWay[], excludeIds: readonly number[] = []): OsmWay[] {
  const excluded = new Set(excludeIds)
  return ways.filter((w) => !isPitLane(w) && !excluded.has(w.id))
}
