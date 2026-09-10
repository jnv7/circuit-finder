// Saved placements: one per circuit, keyed by `circuitId`. A SavedPlacement is
// the Phase 2 `Placement` (anchor / rotation / scale) plus its circuit id, a
// schema version, and a save timestamp. Nothing about the street data or the
// proximity result is stored — both recompute on load. All pure; the
// localStorage glue lives in `src/app/storage.ts`. See
// docs/specs/phase-4-save-restore-export.md.
import type { LonLat } from './geo'
import type { Placement } from './app/overlay'
import { MAX_SCALE, MIN_SCALE } from './app/state'

export const PLACEMENTS_SCHEMA_VERSION = 2

/** Stored schema versions this build can read (all normalised to the latest). */
const ACCEPTED_SCHEMA_VERSIONS = [1, 2]

export type SavedPlacement = {
  schemaVersion: typeof PLACEMENTS_SCHEMA_VERSION
  circuitId: string
  anchor: LonLat
  rotationRad: number
  scale: number
  /** The traced route: ordered [lon, lat] vertices, ≥ 2 when present, omitted when empty. */
  route?: LonLat[]
  /** ISO 8601 UTC. */
  savedAt: string
}

/** A stored map of circuit id → its one saved placement. */
export type PlacementStore = Readonly<Record<string, SavedPlacement>>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Validate one stored value as a SavedPlacement. Throws with a descriptive
 * message on the first problem. The circuit's *existence* is the caller's
 * concern — a value stored by a future build with more circuits still parses.
 */
export function validatePlacement(value: unknown, where = 'placement'): SavedPlacement {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where} must be an object`)
  }
  const record = value as Record<string, unknown>

  if (
    typeof record['schemaVersion'] !== 'number' ||
    !ACCEPTED_SCHEMA_VERSIONS.includes(record['schemaVersion'])
  ) {
    throw new Error(
      `${where} schemaVersion must be one of ${ACCEPTED_SCHEMA_VERSIONS.join(', ')}`,
    )
  }
  if (!isNonEmptyString(record['circuitId'])) {
    throw new Error(`${where} circuitId must be a non-empty string`)
  }

  const anchor = record['anchor']
  if (
    !Array.isArray(anchor) ||
    anchor.length !== 2 ||
    !isFiniteNumber(anchor[0]) ||
    !isFiniteNumber(anchor[1]) ||
    anchor[0] < -180 ||
    anchor[0] > 180 ||
    anchor[1] < -90 ||
    anchor[1] > 90
  ) {
    throw new Error(`${where} anchor must be [lon, lat] within valid ranges`)
  }

  if (!isFiniteNumber(record['rotationRad'])) {
    throw new Error(`${where} rotationRad must be a finite number`)
  }
  if (
    !isFiniteNumber(record['scale']) ||
    record['scale'] < MIN_SCALE ||
    record['scale'] > MAX_SCALE
  ) {
    throw new Error(`${where} scale must be a finite number within [${MIN_SCALE}, ${MAX_SCALE}]`)
  }

  if (!isNonEmptyString(record['savedAt']) || Number.isNaN(Date.parse(record['savedAt']))) {
    throw new Error(`${where} savedAt must be a valid date string`)
  }

  const route = validateRoute(record['route'], where)

  const out: SavedPlacement = {
    schemaVersion: PLACEMENTS_SCHEMA_VERSION,
    circuitId: record['circuitId'],
    anchor: [anchor[0], anchor[1]],
    rotationRad: record['rotationRad'],
    scale: record['scale'],
    savedAt: record['savedAt'],
  }
  if (route.length >= 2) out.route = route
  return out
}

/**
 * Validate an optional stored `route`: absent / empty → `[]`; otherwise an array
 * of ≥ 2 `[lon, lat]` pairs in range. A single-point route is a data error.
 */
function validateRoute(value: unknown, where: string): LonLat[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`${where} route must be an array`)
  }
  if (value.length === 1) {
    throw new Error(`${where} route must have at least 2 points`)
  }
  return value.map((pair, i) => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !isFiniteNumber(pair[0]) ||
      !isFiniteNumber(pair[1]) ||
      pair[0] < -180 ||
      pair[0] > 180 ||
      pair[1] < -90 ||
      pair[1] > 90
    ) {
      throw new Error(`${where} route[${i}] must be [lon, lat] within valid ranges`)
    }
    return [pair[0], pair[1]] as LonLat
  })
}

/** Build a fresh SavedPlacement from the current map state. A route shorter than
 *  2 points is stored as an omitted field. */
export function makeSavedPlacement(
  circuitId: string,
  placement: Placement,
  route: readonly LonLat[],
  now: Date,
): SavedPlacement {
  const out: SavedPlacement = {
    schemaVersion: PLACEMENTS_SCHEMA_VERSION,
    circuitId,
    anchor: [placement.anchor[0], placement.anchor[1]],
    rotationRad: placement.rotationRad,
    scale: placement.scale,
    savedAt: now.toISOString(),
  }
  if (route.length >= 2) out.route = route.map((p) => [p[0], p[1]] as LonLat)
  return out
}

/** The Phase 2 `Placement` carried by a SavedPlacement. */
export function savedToPlacement(saved: SavedPlacement): Placement {
  return {
    anchor: [saved.anchor[0], saved.anchor[1]],
    rotationRad: saved.rotationRad,
    scale: saved.scale,
  }
}

/** The traced route carried by a SavedPlacement, as a fresh array (`[]` if none). */
export function savedRoute(saved: SavedPlacement): LonLat[] {
  return (saved.route ?? []).map((p) => [p[0], p[1]] as LonLat)
}

/** Same length and exact component-wise equality. */
export function routesEqual(a: readonly LonLat[], b: readonly LonLat[]): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1])
}

/** Exact compare of anchor (both components), rotation and scale. */
export function placementsEqual(a: Placement, b: Placement): boolean {
  return (
    a.anchor[0] === b.anchor[0] &&
    a.anchor[1] === b.anchor[1] &&
    a.rotationRad === b.rotationRad &&
    a.scale === b.scale
  )
}

export function getPlacement(store: PlacementStore, circuitId: string): SavedPlacement | undefined {
  return Object.prototype.hasOwnProperty.call(store, circuitId) ? store[circuitId] : undefined
}

/** A new store with `saved` set under its own `circuitId`. */
export function setPlacement(store: PlacementStore, saved: SavedPlacement): PlacementStore {
  return { ...store, [saved.circuitId]: saved }
}

/** A new store without `circuitId`. */
export function removePlacement(store: PlacementStore, circuitId: string): PlacementStore {
  if (!Object.prototype.hasOwnProperty.call(store, circuitId)) return { ...store }
  const next: Record<string, SavedPlacement> = { ...store }
  delete next[circuitId]
  return next
}

/**
 * Parse the raw `localStorage` string into a store. Tolerant: `null`, bad JSON,
 * a non-object or an array all yield `{}`. Each entry is validated; an invalid
 * one, or one whose stored `circuitId` disagrees with its key, is dropped with
 * a `console.warn` so one bad record never hides the rest.
 */
export function parseStoredPlacements(raw: string | null): Record<string, SavedPlacement> {
  if (raw === null) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('placements: stored value is not valid JSON; ignoring')
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('placements: stored value is not an object; ignoring')
    return {}
  }

  const out: Record<string, SavedPlacement> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    try {
      const saved = validatePlacement(value, `placements["${key}"]`)
      if (saved.circuitId !== key) {
        console.warn(`placements: entry "${key}" has circuitId "${saved.circuitId}"; dropping`)
        continue
      }
      out[key] = saved
    } catch (err) {
      console.warn(`placements: dropping invalid entry "${key}": ${(err as Error).message}`)
    }
  }
  return out
}

export function serialisePlacements(store: PlacementStore): string {
  return JSON.stringify(store)
}
