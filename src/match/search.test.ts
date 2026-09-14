import { describe, it, expect } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { longestStraight } from '../geometry/straight'
import { pathLength, recenter, resample } from '../geometry/path'
import { transformPath } from '../geometry/transform'
import type { Point } from '../geometry/types'
import { portoProjection } from '../porto'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import type { Street } from '../streets'
import { scoreCandidate } from './objective'
import { DEFAULT_SEARCH_OPTIONS, searchPlacements } from './search'
import { findMatchingStreetStraights, seedFromStraight } from './straights'
import type { SearchInput, SearchProgress, Suggestion } from './types'

/** Reproduces `searchPlacements`' coarse-sweep + seed pool, outside the
 *  generator, purely to measure macro-cell representation before/after
 *  Phase 15's spatial-quota keep for the ROADMAP decision log — not
 *  production code, and not a separate selection path the app ever runs. */
function coarsePoolForDiagnostics(input: SearchInput): { anchorM: Point; score: number }[] {
  const o = DEFAULT_SEARCH_OPTIONS
  const scoreOpts = { alignMaxRad: o.alignMaxRad, minCoverage: o.minCoverage }
  const { min, max } = input.bbox
  const pool: { anchorM: Point; score: number }[] = []

  const matchingStraights = findMatchingStreetStraights(
    input.ways,
    input.circuitStraight.lengthM * input.scale,
  )
  for (const streetStraight of matchingStraights) {
    for (const candidate of seedFromStraight(input.circuitStraight, streetStraight)) {
      const score = scoreCandidate(input, candidate, o.samplesCoarse, scoreOpts)
      if (score.coverage >= o.minCoverage) pool.push({ anchorM: candidate.anchorM, score: score.score })
    }
  }

  for (let x = min[0]; x <= max[0] + 1e-9; x += o.coarseGridM) {
    for (let y = min[1]; y <= max[1] + 1e-9; y += o.coarseGridM) {
      for (let d = 0; d < 360 - o.coarseRotDeg + 1e-9; d += o.coarseRotDeg) {
        const candidate = { anchorM: [x, y] as Point, rotationRad: (d * Math.PI) / 180 }
        const score = scoreCandidate(input, candidate, o.samplesCoarse, scoreOpts)
        if (score.coverage >= o.minCoverage) pool.push({ anchorM: candidate.anchorM, score: score.score })
      }
    }
  }
  return pool
}

function macroCellKey(anchorM: Point, spreadCellM: number): string {
  return `${Math.floor(anchorM[0] / spreadCellM)},${Math.floor(anchorM[1] / spreadCellM)}`
}

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

  // Phase 15: this cluster's own spread (300-424 m) is far smaller than
  // `spreadCellM` (2000 m), so all three anchors now fall in the *same*
  // macro-cell — spatial-quota coarse-keep lets only that cell's single
  // best-scoring winner reach refine at all, before Phase 12's diversity
  // pass (which operates on whatever survives that much earlier cut) ever
  // gets multiple candidates to work with. This is the explicit, documented
  // trade-off of "no padding from an already-represented cell" (spec
  // phase-15-spatial-quota-search.md): a circuit whose only viable area
  // fits inside one macro-cell now honestly returns fewer than
  // `resultCount` suggestions, rather than padding the list with
  // near-duplicates plucked from the same small neighbourhood.
  it('returns fewer than resultCount, not padded with near-duplicates, when the only viable area fits in one macro-cell', () => {
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex(clusterStreets, 50),
      bbox: diversityBbox,
      ...noSeed,
    }
    const { suggestions } = drain(searchPlacements(input, { resultCount: 2 }))
    expect(suggestions).toHaveLength(1)
    expect(clusterAnchors.some((c) => isNear(suggestions[0]!, c, 300))).toBe(true)
  })
})

// --- Phase 15: spatial-quota coarse-keep. A dense cluster of high-scoring
// candidates in one macro-cell, plus several lower-but-viable candidates each
// alone in its own, separate macro-cell — today's flat top-coarseKeep would
// fill entirely from the dense cluster; spatial-quota keeps at most one
// candidate per macro-cell. ---
describe('searchPlacements — spatial-quota coarse-keep', () => {
  const SPREAD_CELL_M = 2000
  // Anchors are multiples of `coarseGridM` (300) so the grid sweep — which
  // steps from the bbox's own min (also a multiple of 300) — actually lands
  // exactly on them; off-grid anchors would score 0 everywhere and make
  // these assertions pass vacuously on empty candidate pools.
  // Dense cluster: several near-duplicate high-scoring anchors, all inside
  // macro-cell (0, 0) under a 2000 m cell size.
  const denseAnchors: Point[] = [
    [300, 300],
    [600, 300],
    [900, 600],
    [300, 900],
  ]
  // Separate, lower-scoring (smaller, partial-coverage) candidates, each
  // alone in its own distant macro-cell.
  const scatteredAnchors: Point[] = [
    [2400, 300], // macro-cell (1, 0)
    [300, 2400], // macro-cell (0, 1)
    [4500, 4500], // macro-cell (2, 2)
    [-2400, 300], // macro-cell (-2, 0) — floor(-2400/2000) = -2
  ]

  function outlineAt(anchor: Point): Street {
    const outline = transformPath({ translate: anchor, rotation: 0, scale: 1 }, shape)
    return [...outline, outline[0]!]
  }

  const denseStreets = denseAnchors.map(outlineAt)
  const scatteredStreets = scatteredAnchors.map(outlineAt)
  const bbox = { min: [-3000, -3000] as Point, max: [5000, 5000] as Point }
  const noSeed = { ways: [] as Street[], circuitStraight }

  it('regression guard: flat top-coarseKeep alone would fill entirely from the dense cluster', () => {
    // Reproduces the pre-Phase-15 selection directly: sort by score, slice.
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex([...denseStreets, ...scatteredStreets], 50),
      bbox,
      ...noSeed,
    }
    const o = { ...DEFAULT_SEARCH_OPTIONS, coarseKeep: 4 }
    const scoreOpts = { alignMaxRad: o.alignMaxRad, minCoverage: o.minCoverage }
    const xs: number[] = []
    for (let v = bbox.min[0]; v <= bbox.max[0]; v += o.coarseGridM) xs.push(v)
    const ys: number[] = []
    for (let v = bbox.min[1]; v <= bbox.max[1]; v += o.coarseGridM) ys.push(v)
    const rots: number[] = []
    for (let d = 0; d < 360; d += o.coarseRotDeg) rots.push((d * Math.PI) / 180)

    const coarse: { candidate: { anchorM: Point; rotationRad: number }; score: { score: number } }[] =
      []
    for (const x of xs) {
      for (const y of ys) {
        for (const rotationRad of rots) {
          const candidate = { anchorM: [x, y] as Point, rotationRad }
          const score = scoreCandidate(input, candidate, o.samplesCoarse, scoreOpts)
          if (score.coverage >= o.minCoverage) coarse.push({ candidate, score })
        }
      }
    }
    coarse.sort((a, b) => b.score.score - a.score.score)
    const flatKept = coarse.slice(0, o.coarseKeep)

    const cellsOccupied = new Set(
      flatKept.map(
        (k) =>
          `${Math.floor(k.candidate.anchorM[0] / SPREAD_CELL_M)},${Math.floor(k.candidate.anchorM[1] / SPREAD_CELL_M)}`,
      ),
    )
    expect(cellsOccupied.size).toBe(1)
  })

  it('spatial-quota keeps at most one candidate per macro-cell and includes the separate cells', () => {
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex([...denseStreets, ...scatteredStreets], 50),
      bbox,
      ...noSeed,
    }
    const { suggestions } = drain(searchPlacements(input, { coarseKeep: 4, resultCount: 4 }))

    const cellsOccupied = new Set(
      suggestions.map((s) => {
        const a = project.toLocal(s.placement.anchor)
        return `${Math.floor(a[0] / SPREAD_CELL_M)},${Math.floor(a[1] / SPREAD_CELL_M)}`
      }),
    )
    expect(cellsOccupied.size).toBeGreaterThan(1)
  })

  it('a macro-cell with only one viable candidate contributes exactly that one; an empty macro-cell contributes nothing', () => {
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex(scatteredStreets, 50),
      bbox,
      ...noSeed,
    }
    const { suggestions } = drain(searchPlacements(input, { resultCount: scatteredAnchors.length }))
    const cellsOccupied = new Set(
      suggestions.map((s) => {
        const a = project.toLocal(s.placement.anchor)
        return `${Math.floor(a[0] / SPREAD_CELL_M)},${Math.floor(a[1] / SPREAD_CELL_M)}`
      }),
    )
    expect(cellsOccupied.size).toBe(suggestions.length)
  })

  it('fewer occupied macro-cells than coarseKeep: every occupied cell is kept, no duplicate padding', () => {
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index: buildStreetIndex(scatteredStreets, 50),
      bbox,
      ...noSeed,
    }
    const { suggestions } = drain(searchPlacements(input, { coarseKeep: 16, resultCount: 16 }))
    // Only 4 distinct macro-cells exist in this fixture.
    const cellsOccupied = new Set(
      suggestions.map((s) => {
        const a = project.toLocal(s.placement.anchor)
        return `${Math.floor(a[0] / SPREAD_CELL_M)},${Math.floor(a[1] / SPREAD_CELL_M)}`
      }),
    )
    expect(suggestions.length).toBeLessThanOrEqual(scatteredAnchors.length)
    expect(cellsOccupied.size).toBe(suggestions.length)
  })

  it('a straight-anchored seed in an otherwise-unrepresented macro-cell can become that cell winner', () => {
    // The needle fixture (from the straight-anchored seeding tests above):
    // no grid-sweep candidate is remotely competitive there without a seed,
    // so if the far macro-cell shows up at all, the seed alone put it there.
    const input: SearchInput = {
      circuitSamplesM: needleSamplesM,
      scale: 1,
      index: buildStreetIndex([offGridStreet], 50),
      bbox: needleBbox,
      ways: [offGridStreet],
      circuitStraight: needleCircuitStraight,
    }
    const { suggestions } = drain(searchPlacements(input))
    const seedCell = `${Math.floor(OFF_GRID_ANCHOR[0] / SPREAD_CELL_M)},${Math.floor(OFF_GRID_ANCHOR[1] / SPREAD_CELL_M)}`
    const cellsOccupied = suggestions.map((s) => {
      const a = project.toLocal(s.placement.anchor)
      return `${Math.floor(a[0] / SPREAD_CELL_M)},${Math.floor(a[1] / SPREAD_CELL_M)}`
    })
    expect(cellsOccupied).toContain(seedCell)
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
        // Phase 15: how many distinct macro-cells the final result list
        // occupies, and the top pick's own macro-cell — direct before/after
        // comparison against this phase's own investigation baseline (today:
        // 3-4 of 13-16 regions ever reached `kept` at all).
        const macroCellOf = (s: Suggestion) => macroCellKey(project.toLocal(s.placement.anchor), DEFAULT_SEARCH_OPTIONS.spreadCellM)
        const macroCells = new Set(suggestions.map(macroCellOf))
        const topCell = suggestions.length > 0 ? macroCellOf(suggestions[0]!) : 'n/a'

        // Before/after for `kept` itself (the pool this phase actually
        // changes): reproduce the same coarse pool this search just scored,
        // and compare today's flat top-coarseKeep against Phase 15's
        // spatial-quota keep, both capped at the same coarseKeep budget.
        const pool = coarsePoolForDiagnostics(input)
        const occupiedRegions = new Set(pool.map((c) => macroCellKey(c.anchorM, DEFAULT_SEARCH_OPTIONS.spreadCellM)))
        const flatTopKept = [...pool]
          .sort((a, b) => b.score - a.score)
          .slice(0, DEFAULT_SEARCH_OPTIONS.coarseKeep)
        const flatTopKeptCells = new Set(flatTopKept.map((c) => macroCellKey(c.anchorM, DEFAULT_SEARCH_OPTIONS.spreadCellM)))
        const macroWinners = new Map<string, { anchorM: Point; score: number }>()
        for (const c of pool) {
          const key = macroCellKey(c.anchorM, DEFAULT_SEARCH_OPTIONS.spreadCellM)
          const existing = macroWinners.get(key)
          if (!existing || c.score > existing.score) macroWinners.set(key, c)
        }
        const spatialQuotaKeptCells = [...macroWinners.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, DEFAULT_SEARCH_OPTIONS.coarseKeep)

        // Reported in the ROADMAP decision-log entry: before/after spread
        // comparison for the 2026-09-11 clustering open question.
        console.log(
          `searchPlacements (real data, ${circuit.id}): ${elapsedMs.toFixed(0)} ms, ` +
            `${straightMatches.length} matching street straights, ` +
            `max pairwise anchor distance ${Math.round(maxPairwiseM)} m, ` +
            `${macroCells.size} distinct macro-cells in final result, top pick's macro-cell ${topCell}; ` +
            `kept-pool macro-cells: ${occupiedRegions.size} occupied regions total, ` +
            `flat top-${DEFAULT_SEARCH_OPTIONS.coarseKeep} (old) reached ${flatTopKeptCells.size}, ` +
            `spatial-quota (new) reaches ${spatialQuotaKeptCells.length}`,
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
