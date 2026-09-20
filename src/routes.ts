// Phase 22 output: one committed JSON file per circuit
// (`src/data/routes/<circuitId>.json`), each holding a handful of generated
// routes for that circuit plus how they were made. `validateRouteFile` is the
// same "throw a descriptive message on the first problem, else return the
// typed value" contract as `circuits.ts`/`streets.ts`. See
// src/data/routes.schema.md and docs/specs/phase-22-route-generator.md.
import type { Attribution } from './attribution'
import { validateAttribution } from './attribution'
import { loadCircuits } from './circuits'

export type RouteFile = {
  schemaVersion: 1
  circuitId: string
  generatedAt: string
  scale: number
  generator: {
    poses: number
    escalationTier: number
    bar: { meanM: number; maxM: number; ratioLo: number; ratioHi: number; retrace: number }
  }
  streets: Attribution
  routes: RouteEntry[]
}

export type RouteEntry = {
  rank: number
  passesBar: boolean
  area?: string
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

function validateBar(value: unknown, where: string): RouteFile['generator']['bar'] {
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

function validateRouteEntry(value: unknown, index: number, expectedRank: number): RouteEntry {
  const where = `route at index ${index}`
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`)
  const record = value as Record<string, unknown>

  if (record['rank'] !== expectedRank) {
    throw new Error(`${where} must have rank ${expectedRank} (routes must be ranked 1..n, in order)`)
  }
  if (typeof record['passesBar'] !== 'boolean') throw new Error(`${where}.passesBar must be a boolean`)
  if (record['area'] !== undefined && typeof record['area'] !== 'string') {
    throw new Error(`${where}.area must be a string when present`)
  }

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
    rank: expectedRank,
    passesBar: record['passesBar'] as boolean,
    area: record['area'] as string | undefined,
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

  if (record['schemaVersion'] !== 1) throw new Error('route file schemaVersion must be 1')

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
  const generatorRecord = generatorValue as Record<string, unknown>
  if (!isFiniteNumber(generatorRecord['poses']) || generatorRecord['poses'] < 0) {
    throw new Error('route file generator.poses must be a non-negative finite number')
  }
  if (![0, 1, 2].includes(generatorRecord['escalationTier'] as number)) {
    throw new Error('route file generator.escalationTier must be 0, 1, or 2')
  }
  const bar = validateBar(generatorRecord['bar'], 'route file generator.bar')

  const streets = validateAttribution(record['streets'], 'route file streets')

  const rawRoutes = record['routes']
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
    throw new Error('route file routes must be a non-empty array')
  }
  const routes = rawRoutes.map((r, i) => validateRouteEntry(r, i, i + 1))

  return {
    schemaVersion: 1,
    circuitId: record['circuitId'] as string,
    generatedAt: record['generatedAt'] as string,
    scale: record['scale'] as number,
    generator: {
      poses: generatorRecord['poses'] as number,
      escalationTier: generatorRecord['escalationTier'] as number,
      bar,
    },
    streets,
    routes,
  }
}

/** Validate `data` as a route file against the bundled circuit list. */
export function loadRouteFile(data: unknown): RouteFile {
  const knownCircuitIds = loadCircuits().map((c) => c.id)
  return validateRouteFile(data, knownCircuitIds)
}
