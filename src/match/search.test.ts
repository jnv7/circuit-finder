import { describe, it, expect } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { longestStraight } from '../geometry/straight'
import { pathLength, recenter, resample } from '../geometry/path'
import { transformPath } from '../geometry/transform'
import type { Point } from '../geometry/types'
import { portoProjection } from '../porto'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import type { Street } from '../streets'
import { DEFAULT_SEARCH_OPTIONS, searchPlacements } from './search'
import { findMatchingStreetStraights } from './straights'
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
const shapeStraight = longestStraight(shape, { closed: true })
const circuitStraight = {
  a: shape[shapeStraight.startIndex]!,
  b: shape[shapeStraight.endIndex]!,
  lengthM: shapeStraight.lengthM,
}

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
    ways: [plantedStreet],
    circuitStraight,
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

// --- Phase 12: straight-anchored seeding. A thin needle-shaped loop whose
// coverage is all-or-nothing on translation: any position off by more than
// `NEAR_M` in either axis scores 0, so a real street sitting off the coarse
// 300 m grid is entirely invisible to the grid sweep alone — only an exact,
// analytically-placed seed can find it. ---
const needle: Point[] = [
  [-100, -1],
  [100, -1],
  [100, 1],
  [-100, 1],
]
const needleSamplesM = resample(needle, 12, true)
const needleStraight = longestStraight(needle, { closed: true })
const needleCircuitStraight = {
  a: needle[needleStraight.startIndex]!,
  b: needle[needleStraight.endIndex]!,
  lengthM: needleStraight.lengthM,
}
// Off the 300 m coarse grid on both axes.
const OFF_GRID_ANCHOR: Point = [137, 253]
// Only the bottom edge, exactly matching the circuit's own longest straight —
// the top edge (2 m away) still counts as "near" once the bottom is aligned.
const offGridStreet: Street = [
  [needle[0]![0] + OFF_GRID_ANCHOR[0], needle[0]![1] + OFF_GRID_ANCHOR[1]],
  [needle[1]![0] + OFF_GRID_ANCHOR[0], needle[1]![1] + OFF_GRID_ANCHOR[1]],
]
const needleBbox = { min: [0, 0] as Point, max: [2400, 1800] as Point }
const needleIndex = buildStreetIndex([offGridStreet], 50)

describe('searchPlacements — straight-anchored seeding surfaces off-grid spots', () => {
  function isNearOffGridAnchor(s: Suggestion): boolean {
    const a = project.toLocal(s.placement.anchor)
    return Math.hypot(a[0] - OFF_GRID_ANCHOR[0], a[1] - OFF_GRID_ANCHOR[1]) < 30
  }

  it('the grid sweep alone (no matching ways) never finds the off-grid street', () => {
    const input: SearchInput = {
      circuitSamplesM: needleSamplesM,
      scale: 1,
      index: needleIndex,
      bbox: needleBbox,
      ways: [],
      circuitStraight: needleCircuitStraight,
    }
    const { suggestions } = drain(searchPlacements(input))
    expect(suggestions.some(isNearOffGridAnchor)).toBe(false)
  })

  it('a straight-anchored seed surfaces it once the matching street is supplied', () => {
    const input: SearchInput = {
      circuitSamplesM: needleSamplesM,
      scale: 1,
      index: needleIndex,
      bbox: needleBbox,
      ways: [offGridStreet],
      circuitStraight: needleCircuitStraight,
    }
    const { suggestions } = drain(searchPlacements(input))
    expect(suggestions.some(isNearOffGridAnchor)).toBe(true)
  })
})

// --- Phase 12: diversity in final selection. A crowded cluster of three
// mutually-close good spots (each >dedupDistM apart from each other, so all
// three survive dedup) plus one distant good spot, more than diversityDistM
// from every cluster member. Without the diversity pass, the crowded
// cluster's near-duplicates alone could fill every slot. ---
describe('searchPlacements — diversity in final selection', () => {
  const B1: Point = [1200, 900]
  const B2: Point = [1500, 900] // 300 m from B1
  const B3: Point = [1200, 1200] // 300 m from B1, ~424 m from B2
  const clusterAnchors = [B1, B2, B3]
  const farAnchor: Point = [1200, 2400] // >=1200 m from every cluster anchor
  const diversityBbox = { min: [0, 0] as Point, max: [2400, 2700] as Point }
  const noSeed = { ways: [] as Street[], circuitStraight }

  function outlineAt(anchor: Point): Street {
    const outline = transformPath({ translate: anchor, rotation: 0, scale: 1 }, shape)
    return [...outline, outline[0]!]
  }

  const clusterStreets = clusterAnchors.map(outlineAt)
  const farStreet = outlineAt(farAnchor)

  function isNear(s: Suggestion, target: Point, maxM: number): boolean {
    const a = project.toLocal(s.placement.anchor)
    return Math.hypot(a[0] - target[0], a[1] - target[1]) < maxM
  }

  it('spreads results across the crowded cluster and the distant spot instead of filling every slot from the cluster', () => {
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex([...clusterStreets, farStreet], 50),
      bbox: diversityBbox,
      ...noSeed,
    }
    const { suggestions } = drain(searchPlacements(input, { resultCount: 2 }))

    expect(suggestions).toHaveLength(2)
    const nearCluster = suggestions.some((s) => clusterAnchors.some((c) => isNear(s, c, 100)))
    const nearFar = suggestions.some((s) => isNear(s, farAnchor, 100))
    expect(nearCluster).toBe(true)
    expect(nearFar).toBe(true)
  })

  it('still returns resultCount suggestions when only the crowded cluster is plausible', () => {
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex(clusterStreets, 50),
      bbox: diversityBbox,
      ...noSeed,
    }
    const { suggestions } = drain(searchPlacements(input, { resultCount: 2 }))
    expect(suggestions).toHaveLength(2)
  })
})

describe('searchPlacements — real Porto data', () => {
  it(
    'returns plausible, spread-out suggestions inside the bbox for every bundled circuit',
    () => {
      const network = loadStreetNetwork()
      const index = buildStreetIndex(network.ways)
      const sw = project.toLocal([network.bbox[0], network.bbox[1]])
      const ne = project.toLocal([network.bbox[2], network.bbox[3]])
      const bbox = {
        min: [Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1])] as Point,
        max: [Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])] as Point,
      }

      for (const circuit of loadMetricCircuits()) {
        const input: SearchInput = {
          circuitSamplesM: resample(circuit.metricCentreline, 5),
          scale: 1,
          index,
          bbox,
          ways: network.ways,
          circuitStraight: {
            a: circuit.metricCentreline[circuit.longestStraight.startIndex]!,
            b: circuit.metricCentreline[circuit.longestStraight.endIndex]!,
            lengthM: circuit.longestStraight.lengthM,
          },
        }

        const straightMatches = findMatchingStreetStraights(
          input.ways,
          input.circuitStraight.lengthM * input.scale,
        )

        const started = performance.now()
        const { suggestions, progress } = drain(searchPlacements(input))
        const elapsedMs = performance.now() - started

        const anchorsM = suggestions.map((s) => project.toLocal(s.placement.anchor))
        let maxPairwiseM = 0
        for (let i = 0; i < anchorsM.length; i++) {
          for (let j = i + 1; j < anchorsM.length; j++) {
            const d = Math.hypot(anchorsM[i]![0] - anchorsM[j]![0], anchorsM[i]![1] - anchorsM[j]![1])
            if (d > maxPairwiseM) maxPairwiseM = d
          }
        }
        // Reported in the ROADMAP decision-log entry: before/after spread
        // comparison for the 2026-09-11 clustering open question.
        console.log(
          `searchPlacements (real data, ${circuit.id}): ${elapsedMs.toFixed(0)} ms, ` +
            `${straightMatches.length} matching street straights, ` +
            `max pairwise anchor distance ${Math.round(maxPairwiseM)} m`,
        )

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
      }
    },
    120_000,
  )
})
