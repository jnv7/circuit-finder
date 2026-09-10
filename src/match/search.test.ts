import { describe, it, expect } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { pathLength, recenter, resample } from '../geometry/path'
import { transformPath } from '../geometry/transform'
import type { Point } from '../geometry/types'
import { portoProjection } from '../porto'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import type { Street } from '../streets'
import { DEFAULT_SEARCH_OPTIONS, searchPlacements } from './search'
import type { SearchInput, SearchProgress, Suggestion } from './types'

function drain(gen: Generator<SearchProgress, Suggestion[]>): {
  progress: SearchProgress[]
  suggestions: Suggestion[]
} {
  const progress: SearchProgress[] = []
  let step = gen.next()
  while (!step.done) {
    progress.push(step.value)
    step = gen.next()
  }
  return { progress, suggestions: step.value }
}

// An asymmetric triangle (no rotational symmetry), centroid at the origin.
const shape = recenter([
  [-150, -100],
  [250, -50],
  [0, 200],
])
const circuitSamplesM = resample(shape, 12, true)

const PLANTED_ANCHOR: Point = [1200, 900]
const PLANTED_ROT = 0
const plantedOutline = transformPath(
  { translate: PLANTED_ANCHOR, rotation: PLANTED_ROT, scale: 1 },
  shape,
)
const plantedStreet: Street = [...plantedOutline, plantedOutline[0]!]

const project = portoProjection()

function angleDeltaDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return (d * 180) / Math.PI
}

describe('searchPlacements — planted optimum', () => {
  const input: SearchInput = {
    circuitSamplesM,
    scale: 1,
    index: buildStreetIndex([plantedStreet], 50),
    bbox: { min: [0, 0], max: [2400, 1800] },
  }
  const { progress, suggestions } = drain(searchPlacements(input))

  it('returns between 1 and RESULT_COUNT suggestions', () => {
    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    expect(suggestions.length).toBeLessThanOrEqual(DEFAULT_SEARCH_OPTIONS.resultCount)
  })

  it('puts the planted pose at the top, within the coarse tolerances', () => {
    const top = suggestions[0]!
    const anchorM = project.toLocal(top.placement.anchor)
    expect(Math.hypot(anchorM[0] - PLANTED_ANCHOR[0], anchorM[1] - PLANTED_ANCHOR[1])).toBeLessThan(
      DEFAULT_SEARCH_OPTIONS.coarseGridM,
    )
    expect(angleDeltaDeg(top.placement.rotationRad, PLANTED_ROT)).toBeLessThan(
      DEFAULT_SEARCH_OPTIONS.coarseRotDeg,
    )
    expect(top.coverageFraction).toBeGreaterThan(0.8)
  })

  it('de-duplicates the result list', () => {
    for (let i = 0; i < suggestions.length; i++) {
      for (let j = i + 1; j < suggestions.length; j++) {
        const a = project.toLocal(suggestions[i]!.placement.anchor)
        const b = project.toLocal(suggestions[j]!.placement.anchor)
        const close =
          Math.hypot(a[0] - b[0], a[1] - b[1]) <= DEFAULT_SEARCH_OPTIONS.dedupDistM &&
          angleDeltaDeg(suggestions[i]!.placement.rotationRad, suggestions[j]!.placement.rotationRad) <=
            DEFAULT_SEARCH_OPTIONS.dedupRotDeg
        expect(close).toBe(false)
      }
    }
  })

  it('every suggestion carries the input scale and finite numbers', () => {
    for (const s of suggestions) {
      expect(s.placement.scale).toBe(1)
      expect(Number.isFinite(s.coverageFraction)).toBe(true)
      expect(Number.isFinite(s.meanDeviationM)).toBe(true)
      expect(Number.isFinite(s.maxDeviationM)).toBe(true)
    }
  })

  it('yields monotonic non-decreasing progress ending at done === total', () => {
    expect(progress.length).toBeGreaterThan(0)
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!.done).toBeGreaterThanOrEqual(progress[i - 1]!.done)
      expect(progress[i]!.total).toBe(progress[0]!.total)
    }
    const last = progress[progress.length - 1]!
    expect(last.done).toBe(last.total)
  })
})

describe('searchPlacements — real Porto data', () => {
  it(
    'returns plausible suggestions inside the bbox for a real circuit',
    () => {
      const network = loadStreetNetwork()
      const index = buildStreetIndex(network.ways)
      const sw = project.toLocal([network.bbox[0], network.bbox[1]])
      const ne = project.toLocal([network.bbox[2], network.bbox[3]])
      const bbox = {
        min: [Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1])] as Point,
        max: [Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])] as Point,
      }

      const circuit = loadMetricCircuits()[0]!
      const input: SearchInput = {
        circuitSamplesM: resample(circuit.metricCentreline, 5),
        scale: 1,
        index,
        bbox,
      }

      const started = performance.now()
      const { suggestions, progress } = drain(searchPlacements(input))
      const elapsedMs = performance.now() - started
      // Reported in the ROADMAP decision-log entry.
      console.log(`searchPlacements (real data): ${elapsedMs.toFixed(0)} ms`)

      expect(suggestions.length).toBeGreaterThanOrEqual(1)
      expect(suggestions.length).toBeLessThanOrEqual(DEFAULT_SEARCH_OPTIONS.resultCount)
      const last = progress[progress.length - 1]!
      expect(last.done).toBe(last.total)

      for (const s of suggestions) {
        const anchorM = project.toLocal(s.placement.anchor)
        expect(anchorM[0]).toBeGreaterThanOrEqual(bbox.min[0] - 1)
        expect(anchorM[0]).toBeLessThanOrEqual(bbox.max[0] + 1)
        expect(anchorM[1]).toBeGreaterThanOrEqual(bbox.min[1] - 1)
        expect(anchorM[1]).toBeLessThanOrEqual(bbox.max[1] + 1)
        expect(Number.isFinite(s.coverageFraction)).toBe(true)
        expect(s.placement.scale).toBe(1)
      }

      // Sanity: the resampled circuit is close to its real length.
      expect(pathLength(input.circuitSamplesM, true)).toBeGreaterThan(circuit.lengthM * 0.9)
    },
    120_000,
  )
})
