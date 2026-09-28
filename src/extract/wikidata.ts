// Wikidata parsing for `find-route` (Phase 24): turn a name search and an
// entity fetch into motorsport racetracks that have both a coordinate and an
// official lap length. Pure — the HTTP lives in scripts/find-route.ts.

/** Wikidata classes that count as a motorsport racetrack (recorded in the ROADMAP decision log). */
export const RACETRACK_CLASSES: ReadonlySet<string> = new Set([
  'Q2338524', // motorsport racing track
  'Q926439', // street circuit
])

const METRE = 'Q11573'
const KILOMETRE = 'Q828224'
const MILE = 'Q253276'
const METRES_PER_UNIT: Record<string, number> = { [METRE]: 1, [KILOMETRE]: 1000, [MILE]: 1609.344 }

const API = 'https://www.wikidata.org/w/api.php'

/**
 * URL of a name search restricted to one class of entity. Filtering by class in
 * the search itself matters: a plain name search for "Monaco" returns the
 * country and a football club and never reaches "Circuit de Monaco".
 */
export function searchUrl(term: string, classId: string): string {
  const query = `${term} haswbstatement:P31=${classId}`
  return `${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=10&format=json`
}

/** URL fetching labels, descriptions and claims for up to 50 entities. */
export function entitiesUrl(ids: readonly string[]): string {
  return `${API}?action=wbgetentities&ids=${ids.map(encodeURIComponent).join('%7C')}&props=labels%7Cdescriptions%7Cclaims&languages=en&format=json`
}

export type TrackEntity = {
  id: string
  label: string
  description: string
  lonLat: [number, number]
  lengthM: number
}

type Snak = { snaktype?: string; datavalue?: { value?: unknown } }
type Statement = { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[]> }

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
}

/** Entity ids from a `list=search` response, in result order. */
export function parseSearch(json: unknown): string[] {
  const hits = asRecord(asRecord(json)?.['query'])?.['search']
  if (!Array.isArray(hits)) return []
  return hits.flatMap((h) => {
    const title = asRecord(h)?.['title']
    return typeof title === 'string' && /^Q\d+$/.test(title) ? [title] : []
  })
}

function statements(claims: Record<string, unknown> | undefined, property: string): Statement[] {
  const list = claims?.[property]
  return Array.isArray(list) ? (list as Statement[]) : []
}

function entityIdOf(s: Statement): string | undefined {
  const id = asRecord(s.mainsnak?.datavalue?.value)?.['id']
  return typeof id === 'string' ? id : undefined
}

/** A qualifier's year, from a Wikidata time value ("+2015-00-00T00:00:00Z"). */
function qualifierYear(s: Statement, property: string): number | undefined {
  const time = asRecord(s.qualifiers?.[property]?.[0]?.datavalue?.value)?.['time']
  if (typeof time !== 'string') return undefined
  const year = Number.parseInt(time, 10)
  return Number.isFinite(year) ? year : undefined
}

function lengthM(s: Statement, entityId: string): number {
  const value = asRecord(s.mainsnak?.datavalue?.value)
  const amount = Number(value?.['amount'])
  const unit = typeof value?.['unit'] === 'string' ? value['unit'].split('/').pop()! : ''
  const factor = METRES_PER_UNIT[unit]
  if (factor === undefined || !Number.isFinite(amount)) {
    throw new Error(
      `${entityId}: length statement has an unsupported unit "${unit}" — pass --official-length-m to override`,
    )
  }
  return amount * factor
}

/**
 * The official lap length in metres from an entity's P2043 statements, or
 * undefined when it has none. Superseded layouts (an end-time qualifier) and
 * deprecated statements are dropped; then `preferred` rank wins, else the
 * latest start time (no start time counts as oldest), else the only one left.
 */
export function chooseLengthM(claims: Record<string, unknown> | undefined, entityId: string): number | undefined {
  const current = statements(claims, 'P2043').filter(
    (s) => s.mainsnak?.snaktype === 'value' && s.rank !== 'deprecated' && qualifierYear(s, 'P582') === undefined,
  )
  if (current.length === 0) return undefined
  const preferred = current.filter((s) => s.rank === 'preferred')
  const pool = preferred.length > 0 ? preferred : current
  const start = (s: Statement): number => qualifierYear(s, 'P580') ?? -Infinity
  const best = pool.reduce((a, b) => (start(b) > start(a) ? b : a))
  return lengthM(best, entityId)
}

function coordinateOf(claims: Record<string, unknown> | undefined): [number, number] | undefined {
  for (const s of statements(claims, 'P625')) {
    if (s.rank === 'deprecated') continue
    const v = asRecord(s.mainsnak?.datavalue?.value)
    if (typeof v?.['longitude'] === 'number' && typeof v['latitude'] === 'number') {
      return [v['longitude'], v['latitude']]
    }
  }
  return undefined
}

/**
 * Racetracks in a `wbgetentities` response that have both a coordinate and a
 * length. Layout entities (no coordinate), venues and places are filtered out;
 * `anyClass` skips the class check for an entity the operator named explicitly.
 */
export function parseEntities(json: unknown, options: { anyClass?: boolean } = {}): TrackEntity[] {
  const entities = asRecord(asRecord(json)?.['entities'])
  if (!entities) return []
  const tracks: TrackEntity[] = []
  for (const [id, raw] of Object.entries(entities)) {
    const entity = asRecord(raw)
    const claims = asRecord(entity?.['claims'])
    const isRacetrack = statements(claims, 'P31').some((s) => RACETRACK_CLASSES.has(entityIdOf(s) ?? ''))
    if (!isRacetrack && !options.anyClass) continue
    const lonLat = coordinateOf(claims)
    if (!lonLat) continue
    const length = chooseLengthM(claims, id)
    if (length === undefined) continue
    const label = asRecord(asRecord(entity?.['labels'])?.['en'])?.['value']
    const description = asRecord(asRecord(entity?.['descriptions'])?.['en'])?.['value']
    tracks.push({
      id,
      label: typeof label === 'string' ? label : id,
      description: typeof description === 'string' ? description : '',
      lonLat,
      lengthM: length,
    })
  }
  return tracks
}
