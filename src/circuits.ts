// Circuit data access: load the bundled list, validate it against the full
// schema, and project each centreline into the local metric frame used by the
// geometry toolkit.
//
// Centrelines are normalised copies of OpenStreetMap raceway geometry (ODbL);
// see docs/specs/phase-1-geometry.md and src/data/circuits.schema.md. The app
// never fetches OSM at runtime.
import rawCircuits from './data/circuits.json'
import type { LonLat } from './geo'
import { projectRing } from './geo'
import type { Point, Straight } from './geometry/types'
import { pathLength, recenter } from './geometry/path'
import { longestStraight } from './geometry/straight'

export type Attribution = {
  source: string
  license: string
  url: string
  retrieved: string
}

export type Circuit = {
  id: string
  name: string
  location: { lat: number; lon: number }
  /** Published lap length in metres. */
  officialLengthM: number
  attribution: Attribution
  /** Closed centreline as an open ring of [lon, lat] pairs (first != last). */
  centreline: LonLat[]
}

export type MetricCircuit = Circuit & {
  /** Centreline in local metres, centroid at the origin. Open ring. */
  metricCentreline: Point[]
  /** Lap length of the projected centreline, metres. */
  lengthM: number
  longestStraight: Straight
}

/** Fraction by which the projected centreline length may differ from official. */
const LENGTH_TOLERANCE = 0.2

const MIN_CENTRELINE_POINTS = 20

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function coordsEqual(a: LonLat, b: LonLat): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
}

function validateAttribution(value: unknown, where: string): Attribution {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where} must have an attribution object`)
  }
  const record = value as Record<string, unknown>
  for (const key of ['source', 'license', 'url', 'retrieved'] as const) {
    if (!isNonEmptyString(record[key])) {
      throw new Error(`${where} attribution.${key} must be a non-empty string`)
    }
  }
  return {
    source: record['source'] as string,
    license: record['license'] as string,
    url: record['url'] as string,
    retrieved: record['retrieved'] as string,
  }
}

function validateCentreline(value: unknown, where: string): LonLat[] {
  if (!Array.isArray(value) || value.length < MIN_CENTRELINE_POINTS) {
    throw new Error(`${where} centreline must have at least ${MIN_CENTRELINE_POINTS} points`)
  }
  const ring: LonLat[] = value.map((pair, i) => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'number' ||
      typeof pair[1] !== 'number' ||
      Number.isNaN(pair[0]) ||
      Number.isNaN(pair[1])
    ) {
      throw new Error(`${where} centreline point ${i} must be a [lon, lat] number pair`)
    }
    const [lon, lat] = pair as [number, number]
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error(`${where} centreline point ${i} is out of range`)
    }
    return [lon, lat]
  })
  if (coordsEqual(ring[0]!, ring[ring.length - 1]!)) {
    throw new Error(`${where} centreline must be an open ring (first point repeated at the end)`)
  }
  for (let i = 1; i < ring.length; i++) {
    if (coordsEqual(ring[i - 1]!, ring[i]!)) {
      throw new Error(`${where} centreline has a repeated point at ${i}`)
    }
  }
  return ring
}

/**
 * Validate arbitrary data as a list of circuits. Throws with a descriptive
 * message on the first problem found; returns the typed array on success.
 */
export function validateCircuits(data: unknown): Circuit[] {
  if (!Array.isArray(data)) throw new Error('circuits data must be an array')
  if (data.length === 0) throw new Error('circuits data must not be empty')

  const seenIds = new Set<string>()

  return data.map((entry, index): Circuit => {
    const where = `circuit at index ${index}`
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${where} must be an object`)
    }
    const record = entry as Record<string, unknown>

    const { id, name, location, officialLengthM } = record
    if (!isNonEmptyString(id)) throw new Error(`${where} must have a non-empty string id`)
    if (!isNonEmptyString(name)) throw new Error(`${where} must have a non-empty string name`)
    if (seenIds.has(id)) throw new Error(`duplicate circuit id: ${id}`)
    seenIds.add(id)

    if (typeof location !== 'object' || location === null) {
      throw new Error(`${where} must have a location object`)
    }
    const { lat, lon } = location as Record<string, unknown>
    if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
      throw new Error(`${where} has an invalid latitude`)
    }
    if (typeof lon !== 'number' || Number.isNaN(lon) || lon < -180 || lon > 180) {
      throw new Error(`${where} has an invalid longitude`)
    }

    if (
      typeof officialLengthM !== 'number' ||
      !Number.isFinite(officialLengthM) ||
      officialLengthM <= 0
    ) {
      throw new Error(`${where} must have a positive officialLengthM`)
    }

    const attribution = validateAttribution(record['attribution'], where)
    const centreline = validateCentreline(record['centreline'], where)

    const { points } = projectRing(centreline)
    const projectedLength = pathLength(points, true)
    const ratio = projectedLength / officialLengthM
    if (ratio < 1 - LENGTH_TOLERANCE || ratio > 1 + LENGTH_TOLERANCE) {
      throw new Error(
        `${where} projected centreline length ${Math.round(projectedLength)}m is not within ` +
          `${LENGTH_TOLERANCE * 100}% of officialLengthM ${officialLengthM}m`,
      )
    }

    return {
      id,
      name,
      location: { lat, lon },
      officialLengthM,
      attribution,
      centreline,
    }
  })
}

/** Load and validate the bundled circuit list. */
export function loadCircuits(): Circuit[] {
  return validateCircuits(rawCircuits)
}

/** Project a circuit's centreline to the local metric frame and measure it. */
export function toMetric(circuit: Circuit): MetricCircuit {
  const { points } = projectRing(circuit.centreline)
  const metricCentreline = recenter(points)
  return {
    ...circuit,
    metricCentreline,
    lengthM: pathLength(metricCentreline, true),
    longestStraight: longestStraight(metricCentreline, { closed: true }),
  }
}

/** Load, validate, and project every bundled circuit. */
export function loadMetricCircuits(): MetricCircuit[] {
  return loadCircuits().map(toMetric)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatKm(metres: number): string {
  return `${(metres / 1000).toFixed(2)} km`
}

/** Render the circuit list as an HTML string. Pure; does not touch the DOM. */
export function renderCircuitList(circuits: MetricCircuit[]): string {
  const items = circuits
    .map((circuit) => {
      const lap = formatKm(circuit.lengthM)
      const official = formatKm(circuit.officialLengthM)
      const straight = `${Math.round(circuit.longestStraight.lengthM)} m`
      return (
        `<li><strong>${escapeHtml(circuit.name)}</strong> ` +
        `<span>lap ${lap} (official ${official}) · longest straight ${straight}</span></li>`
      )
    })
    .join('')
  return `<ul>${items}</ul>`
}
