// The Phase 6 placement search: a coarse translation + rotation sweep of the
// circuit over the Porto street index, a local refine of the best poses, then
// de-duplication down to a handful of ranked suggestions. A synchronous
// generator that yields progress — `app/suggest.ts` pumps it in time slices so
// the UI stays responsive. Pure (no DOM, no network). Fixed scale throughout.
import type { Point } from '../geometry/types'
import { scale as scaleVec } from '../geometry/vector'
import { portoProjection } from '../porto'
import { ALIGN_MAX_RAD, MIN_COVERAGE, scoreCandidate } from './objective'
import type { CandidateScore } from './objective'
import { findMatchingStreetStraights, seedFromStraight } from './straights'
import type { Candidate, SearchInput, SearchOptions, SearchProgress, Suggestion } from './types'

const DEG = Math.PI / 180

/** Defaults for every tuning knob (spec "Constants" table). */
export const DEFAULT_SEARCH_OPTIONS = {
  resultCount: 5,
  coarseGridM: 300,
  coarseRotDeg: 30,
  coarseKeep: 16,
  refineSpanM: 180,
  refineStepM: 90,
  refineSpanDeg: 18,
  refineStepDeg: 9,
  samplesCoarse: 40,
  samplesFine: 80,
  minCoverage: MIN_COVERAGE,
  dedupDistM: 200,
  dedupRotDeg: 12,
  diversityDistM: 800,
  alignMaxRad: ALIGN_MAX_RAD,
} as const

type Scored = { candidate: Candidate; score: CandidateScore }

/** Inclusive range `[start, end]` stepped by `step` (always includes `start`). */
function range(start: number, end: number, step: number): number[] {
  const out: number[] = []
  for (let v = start; v <= end + 1e-9; v += step) out.push(v)
  return out
}

/** Smallest absolute angular difference, radians, in `[0, π]`. */
function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  return d
}

function isDuplicate(a: Candidate, b: Candidate, distM: number, rotRad: number): boolean {
  return (
    Math.hypot(a.anchorM[0] - b.anchorM[0], a.anchorM[1] - b.anchorM[1]) <= distM &&
    angleDelta(a.rotationRad, b.rotationRad) <= rotRad
  )
}

export function* searchPlacements(
  input: SearchInput,
  opts: SearchOptions = {},
): Generator<SearchProgress, Suggestion[]> {
  const o = { ...DEFAULT_SEARCH_OPTIONS, ...opts }
  const scoreOpts = {
    searchMaxM: o.searchMaxM,
    wTurning: o.wTurning,
    wProcrustes: o.wProcrustes,
    alignMaxRad: o.alignMaxRad,
    minCoverage: o.minCoverage,
  }
  const { min, max } = input.bbox

  const xs = range(min[0], max[0], o.coarseGridM)
  const ys = range(min[1], max[1], o.coarseGridM)
  const rots = range(0, 360 - o.coarseRotDeg, o.coarseRotDeg).map((d) => d * DEG)

  // Progress is one step per coarse column plus one per refined candidate, and a
  // final full tick so the bar always lands on 100 %.
  const total = xs.length + o.coarseKeep + 1
  let done = 0

  // --- Straight-anchored seeds ---------------------------------------------
  // Real streets whose own longest straight is close in length to the
  // circuit's own — the same reasoning a runner scans a map for by eye.
  // Merged into the same coarse pool as the grid sweep below, so they get
  // identical refine/dedup/diversity treatment, not a separate code path.
  const coarse: Scored[] = []
  const scaledCircuitStraight = {
    a: scaleVec(input.circuitStraight.a, input.scale),
    b: scaleVec(input.circuitStraight.b, input.scale),
  }
  const matchingStraights = findMatchingStreetStraights(
    input.ways,
    input.circuitStraight.lengthM * input.scale,
  )
  for (const streetStraight of matchingStraights) {
    for (const candidate of seedFromStraight(scaledCircuitStraight, streetStraight)) {
      const score = scoreCandidate(input, candidate, o.samplesCoarse, scoreOpts)
      if (score.coverage >= o.minCoverage) coarse.push({ candidate, score })
    }
  }

  // --- Coarse sweep --------------------------------------------------------
  for (const x of xs) {
    for (const y of ys) {
      for (const rotationRad of rots) {
        const candidate: Candidate = { anchorM: [x, y], rotationRad }
        const score = scoreCandidate(input, candidate, o.samplesCoarse, scoreOpts)
        if (score.coverage >= o.minCoverage) coarse.push({ candidate, score })
      }
    }
    done++
    yield { done, total }
  }

  coarse.sort((a, b) => b.score.score - a.score.score)
  const kept = coarse.slice(0, o.coarseKeep)

  // --- Local refine ------------------------------------------------------
  const dxs = range(-o.refineSpanM, o.refineSpanM, o.refineStepM)
  const drs = range(-o.refineSpanDeg, o.refineSpanDeg, o.refineStepDeg).map((d) => d * DEG)

  const refined: Scored[] = []
  for (const k of kept) {
    let best: Scored = {
      candidate: k.candidate,
      score: scoreCandidate(input, k.candidate, o.samplesFine, scoreOpts),
    }
    for (const dx of dxs) {
      for (const dy of dxs) {
        for (const dr of drs) {
          const candidate: Candidate = {
            anchorM: [k.candidate.anchorM[0] + dx, k.candidate.anchorM[1] + dy],
            rotationRad: k.candidate.rotationRad + dr,
          }
          const score = scoreCandidate(input, candidate, o.samplesFine, scoreOpts)
          if (score.score > best.score.score) best = { candidate, score }
        }
      }
    }
    refined.push(best)
    done++
    yield { done, total }
  }

  // --- De-duplicate ---------------------------------------------------------
  refined.sort((a, b) => b.score.score - a.score.score)
  const deduped: Scored[] = []
  for (const r of refined) {
    if (r.score.coverage < o.minCoverage) continue
    if (deduped.some((a) => isDuplicate(a.candidate, r.candidate, o.dedupDistM, o.dedupRotDeg))) {
      continue
    }
    deduped.push(r)
  }

  // --- Diversity: prefer spreading accepted suggestions across the map ----
  // Pass one only fills slots with candidates at least `diversityDistM` from
  // every already-accepted one; pass two fills any slots still empty from the
  // remaining (already deduped) candidates in plain score order, so a circuit
  // with only one good spot in Porto still gets `resultCount` suggestions.
  const accepted: Scored[] = []
  const remaining: Scored[] = []
  for (const r of deduped) {
    const isFarEnough = accepted.every((a) => {
      const dx = a.candidate.anchorM[0] - r.candidate.anchorM[0]
      const dy = a.candidate.anchorM[1] - r.candidate.anchorM[1]
      return Math.hypot(dx, dy) >= o.diversityDistM
    })
    if (accepted.length < o.resultCount && isFarEnough) {
      accepted.push(r)
    } else {
      remaining.push(r)
    }
  }
  for (const r of remaining) {
    if (accepted.length >= o.resultCount) break
    accepted.push(r)
  }
  // Present best-first, same as before this phase — diversity changes which
  // candidates get in, not the ranking of the ones that do.
  accepted.sort((a, b) => b.score.score - a.score.score)

  const project = portoProjection()
  const suggestions: Suggestion[] = accepted.map((a) => {
    const anchor = project.toLonLat(a.candidate.anchorM as Point)
    return {
      placement: { anchor, rotationRad: a.candidate.rotationRad, scale: input.scale },
      coverageFraction: a.score.coverage,
      meanDeviationM: a.score.meanDeviationM,
      maxDeviationM: a.score.maxDeviationM,
    }
  })

  yield { done: total, total }
  return suggestions
}
