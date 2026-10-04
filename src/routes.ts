// Phase 22 output, regionalised in Phase 26: one committed JSON file per
// circuit (`src/data/routes/<circuitId>.json`), holding up to 3 generated
// routes per searched region. `validateRouteFile` is the same "throw a
// descriptive message on the first problem, else return the typed value"
// contract as `circuits.ts`/`streets.ts`. See src/data/routes.schema.md and
// docs/specs/phase-22-route-generator.md / phase-26-regional-search.md.
import type { Attribution } from './attribution'
import { validateAttribution } from './attribution'
import { loadCircuits } from './circuits'
import { isRegionId } from './regions'
import type { RegionId } from './regions'

export type Bar = { meanM: number; maxM: number; ratioLo: number; ratioHi: number; retrace: number }

export type RouteFile = {
  schemaVersion: 2
  circuitId: string
  generatedAt: string
  scale: number
  generator: { bar: Bar }
  /** One entry per region actually searched — lets a maintainer see which
   *  region needed how much search effort (Phase 26's visibility mitigation
   *  for escalation cost varying by circuit/region fit) without digging
   *  through generation logs. */
  regions: { id: RegionId; poses: number; escalationTier: number }[]
  streets: Attribution
  routes: RouteEntry[]
}

export type RouteEntry = {
  region: RegionId
  /** 1 = best, ranked 1..n in order *within this region* — not file-wide,
   *  since every region contributes its own rank-1. */
  rank: number
  passesBar: boolean
  pose: { anchor: [number, number]; rotationRad: number }
  points: [number, number][]
  metrics: {
    lengthM: number
    lengthRatio: number
    meanDeviationM: number
    maxDeviationM: number
    frechetM: number
    retracedFraction: number
  }
}

const MIN_ROUTE_POINTS = 20
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function validateLonLat(value: unknown, where: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isFiniteNumber)) {
    throw new Error(`${where} must be a [lon, lat] pair of finite numbers`)
  }
  const [lon, lat] = value as [number, number]
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`${where} is out of range`)
  }
  return [lon, lat]
}

function validateBar(value: unknown, where: string): Bar {
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`)
  const record = value as Record<string, unknown>
  for (const key of ['meanM', 'maxM', 'ratioLo', 'ratioHi', 'retrace'] as const) {
    if (!isFiniteNumber(record[key])) throw new Error(`${where}.${key} must be a finite number`)
  }
  return {
    meanM: record['meanM'] as number,
    maxM: record['maxM'] as number,
    ratioLo: record['ratioLo'] as number,
    ratioHi: record['ratioHi'] as number,
    retrace: record['retrace'] as number,
  }
}

function validateMetrics(value: unknown, where: string): RouteEntry['metrics'] {
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`)
  const record = value as Record<string, unknown>
  for (const key of [
    'lengthM',
    'lengthRatio',
    'meanDeviationM',
    'maxDeviationM',
    'frechetM',
    'retracedFraction',
  ] as const) {
    if (!isFiniteNumber(record[key])) throw new Error(`${where}.${key} must be a finite number`)
  }
  return {
    lengthM: record['lengthM'] as number,
    lengthRatio: record['lengthRatio'] as number,
    meanDeviationM: record['meanDeviationM'] as number,
    maxDeviationM: record['maxDeviationM'] as number,
    frechetM: record['frechetM'] as number,
    retracedFraction: record['retracedFraction'] as number,
  }
}

function validateRegionEntry(value: unknown, index: number): RouteFile['regions'][number] {
  const where = `regions[${index}]`
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`)
  const record = value as Record<string, unknown>
  if (!isRegionId(record['id'])) throw new Error(`${where}.id must be a known region id`)
  if (!isFiniteNumber(record['poses']) || record['poses'] < 0) {
    throw new Error(`${where}.poses must be a non-negative finite number`)
  }
  if (![0, 1, 2].includes(record['escalationTier'] as number)) {
    throw new Error(`${where}.escalationTier must be 0, 1, or 2`)
  }
  return { id: record['id'], poses: record['poses'] as number, escalationTier: record['escalationTier'] as number }
}

/**
 * Validate one route entry. `expectedRank` is this entry's expected rank
 * *within its own region* — the caller tracks a running rank per region, not
 * a single file-wide counter, since every region contributes its own rank-1.
 */
function validateRouteEntry(value: unknown, index: number, expectedRank: number): RouteEntry {
  const where = `route at index ${index}`
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`)
  const record = value as Record<string, unknown>

  if (!isRegionId(record['region'])) throw new Error(`${where}.region must be a known region id`)
  if (record['rank'] !== expectedRank) {
    throw new Error(
      `${where} must have rank ${expectedRank} (routes must be ranked 1..n, in order, within each region)`,
    )
  }
  if (typeof record['passesBar'] !== 'boolean') throw new Error(`${where}.passesBar must be a boolean`)

  const pose = record['pose']
  if (typeof pose !== 'object' || pose === null) throw new Error(`${where}.pose must be an object`)
  const poseRecord = pose as Record<string, unknown>
  const anchor = validateLonLat(poseRecord['anchor'], `${where}.pose.anchor`)
  if (!isFiniteNumber(poseRecord['rotationRad'])) {
    throw new Error(`${where}.pose.rotationRad must be a finite number`)
  }

  const rawPoints = record['points']
  if (!Array.isArray(rawPoints) || rawPoints.length < MIN_ROUTE_POINTS) {
    throw new Error(`${where}.points must have at least ${MIN_ROUTE_POINTS} points`)
  }
  const points = rawPoints.map((p, i) => validateLonLat(p, `${where}.points[${i}]`))

  const metrics = validateMetrics(record['metrics'], `${where}.metrics`)

  return {
    region: record['region'],
    rank: expectedRank,
    passesBar: record['passesBar'] as boolean,
    pose: { anchor, rotationRad: poseRecord['rotationRad'] as number },
    points,
    metrics,
  }
}

/**
 * Validate arbitrary data as a `RouteFile`. `knownCircuitIds` guards against a
 * file whose `circuitId` doesn't match any bundled circuit (a stale file left
 * over after a circuit was renamed or removed). Throws with a descriptive
 * message on the first problem found.
 */
export function validateRouteFile(data: unknown, knownCircuitIds: readonly string[]): RouteFile {
  if (typeof data !== 'object' || data === null) throw new Error('route file must be an object')
  const record = data as Record<string, unknown>

  if (record['schemaVersion'] !== 2) throw new Error('route file schemaVersion must be 2')

  if (!isNonEmptyString(record['circuitId'])) throw new Error('route file must have a non-empty circuitId')
  if (!knownCircuitIds.includes(record['circuitId'])) {
    throw new Error(`route file circuitId "${record['circuitId']}" does not match any bundled circuit`)
  }

  if (typeof record['generatedAt'] !== 'string' || !DATE_RE.test(record['generatedAt'])) {
    throw new Error('route file generatedAt must be a YYYY-MM-DD string')
  }

  if (!isFiniteNumber(record['scale']) || record['scale'] <= 0) {
    throw new Error('route file scale must be a positive finite number')
  }

  const generatorValue = record['generator']
  if (typeof generatorValue !== 'object' || generatorValue === null) {
    throw new Error('route file generator must be an object')
  }
  const bar = validateBar((generatorValue as Record<string, unknown>)['bar'], 'route file generator.bar')

  const rawRegions = record['regions']
  if (!Array.isArray(rawRegions) || rawRegions.length === 0) {
    throw new Error('route file regions must be a non-empty array')
  }
  const regions = rawRegions.map((r, i) => validateRegionEntry(r, i))
  const regionIds = new Set(regions.map((r) => r.id))
  if (regionIds.size !== regions.length) throw new Error('route file regions must not repeat a region id')

  const streets = validateAttribution(record['streets'], 'route file streets')

  const rawRoutes = record['routes']
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
    throw new Error('route file routes must be a non-empty array')
  }
  const nextRank = new Map<RegionId, number>()
  const routes = rawRoutes.map((r, i) => {
    const regionOfEntry = (r as Record<string, unknown> | null)?.['region']
    if (!isRegionId(regionOfEntry)) throw new Error(`route at index ${i}.region must be a known region id`)
    const expected = (nextRank.get(regionOfEntry) ?? 0) + 1
    const entry = validateRouteEntry(r, i, expected)
    nextRank.set(regionOfEntry, expected)
    if (!regionIds.has(entry.region)) {
      throw new Error(`route at index ${i} has region "${entry.region}" not listed in route file regions`)
    }
    return entry
  })

  return {
    schemaVersion: 2,
    circuitId: record['circuitId'] as string,
    generatedAt: record['generatedAt'] as string,
    scale: record['scale'] as number,
    generator: { bar },
    regions,
    streets,
    routes,
  }
}

/** Validate `data` as a route file against the bundled circuit list. */
export function loadRouteFile(data: unknown): RouteFile {
  const knownCircuitIds = loadCircuits().map((c) => c.id)
  return validateRouteFile(data, knownCircuitIds)
}
