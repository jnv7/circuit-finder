import { describe, expect, it } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { pathLength, resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import { buildStreetGraph } from '../graph'
import { portoProjection } from '../porto'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import type { Street } from '../streets'
import { LOOP_RESULT_COUNT, buildBestEffortLoop, searchRoutedLoops, tryRouteLoop } from './loopSearch'
import type { Candidate, LoopSearchProgress, RoutedSuggestion, SearchInput } from './types'

function drain(
  gen: Generator<LoopSearchProgress, RoutedSuggestion[]>,
): { progress: LoopSearchProgress[]; suggestions: RoutedSuggestion[] } {
  const progress: LoopSearchProgress[] = []
  let step = gen.next()
  while (!step.done) {
    progress.push(step.value)
    step = gen.next()
  }
  return { progress, suggestions: step.value }
}

// A small triangle A-B-C, plus D reachable only via whatever spur each test
// attaches at C — the minimal shape needed to force a there-and-back.
const A: Point = [0, 0]
const B: Point = [100, 0]
const C: Point = [100, 100]
const D: Point = [0, 100]
const triangle: Street[] = [
  [A, B],
  [B, C],
  [C, A],
]
const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
// A, B, C, D plus their midpoints — `sampleIndices(ring.length, 4)` below
// still lands exactly on A/B/C/D (unchanged sample points/assertions), but
// the extra points keep `localHeading`'s `HEADING_SPAN`-index window from
// wrapping onto itself the way it would on a bare 4-point ring (behind and
// ahead indices coinciding, a zero-length heading `nearestAlignedPointM`
// rejects) — a degenerate case only a hand-built 4-point test ring like this
// one hits; a real resampled circuit never does.
const ring: Point[] = [A, mid(A, B), B, mid(B, C), C, mid(C, D), D, mid(D, A)]
const identity: Candidate = { anchorM: [0, 0], rotationRad: 0 }
// A/B/C/D sit at right angles, so the local heading `localHeading` computes
// exactly at one of them is an inherent ~45° diagonal blend of the two
// square sides meeting there — a corner-geometry artifact these tests
// (written for Phase 8/10, before alignment existed) don't care about, since
// they exercise connectivity/ranking/length, not which street a sample
// resolves to. Passing this disables Phase 11's alignment filter for them,
// same as if every street were "aligned" — the pre-Phase-11 behaviour they
// were written against.
const NO_ALIGN_FILTER = Math.PI / 2

describe('tryRouteLoop', () => {
  it('a clean rectangular street loop matching the placed outline closely returns a simple, low-deviation loop', () => {
    const anchor: Point = [1000, 800]
    const bottom: Street = [
      [800, 650],
      [1200, 650],
    ]
    const right: Street = [
      [1200, 650],
      [1200, 950],
    ]
    const top: Street = [
      [1200, 950],
      [800, 950],
    ]
    const left: Street = [
      [800, 950],
      [800, 650],
    ]
    const graph = buildStreetGraph([bottom, right, top, left])
    const rect: Point[] = [
      [-200, -150],
      [200, -150],
      [200, 150],
      [-200, 150],
    ]
    const circuitSamplesM = resample(rect, 15, true)

    const result = tryRouteLoop(circuitSamplesM, { anchorM: anchor, rotationRad: 0 }, 1, graph, {
      samples: 48,
      alignMaxRad: NO_ALIGN_FILTER,
    })

    expect(result).not.toBeNull()
    expect(result!.simple).toBe(true)
    expect(result!.lengthM).toBeGreaterThan(1300)
    expect(result!.lengthM).toBeLessThan(1500)
    expect(result!.meanDeviationM).toBeLessThan(10)
  })

  it('a candidate with a sample over open space (no street within snapMaxM) returns null', () => {
    // No street anywhere near D.
    const graph = buildStreetGraph(triangle)
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })).toBeNull()
  })

  it('a candidate whose ring crosses a gap between two disconnected components returns null', () => {
    // Passes exactly through D, but shares no node with the triangle.
    const isolatedNearD: Street = [
      [-50, 100],
      [50, 100],
    ]
    const graph = buildStreetGraph([...triangle, isolatedNearD])
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })).toBeNull()
  })

  it('a legitimately-connected but far-detouring loop is rejected on length, not shape', () => {
    // C -> D the long way around, even though the ring's own C-D distance is 100 m.
    const longSpur: Street = [
      [100, 100],
      [100, 1000],
      [0, 1000],
      [0, 100],
    ]
    const graph = buildStreetGraph([...triangle, longSpur])
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })).toBeNull()
  })

  it('a single-access side street forcing a there-and-back is accepted but flagged non-simple', () => {
    // The only way to D and back is this one spur off C.
    const shortSpur: Street = [
      [100, 100],
      [0, 100],
    ]
    const graph = buildStreetGraph([...triangle, shortSpur])
    const result = tryRouteLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })
    expect(result).not.toBeNull()
    expect(result!.simple).toBe(false)
    // Longer than the ring's own ~400 m perimeter — the spur is walked twice.
    expect(result!.lengthM).toBeGreaterThan(400)
  })
})

// --- Phase 11: direction-aware snapping. A rectangular through-street loop,
// plus a long stub hanging off the *top* side's midpoint down to just short
// of the bottom side — a real, connected street, but reaching it from
// anywhere on the loop means a long detour up and back down. The circuit's
// own outline is perturbed inward right next to the stub's dangling tip, so
// a plain nearest-point snap picks the stub (closer in raw distance) over
// the horizontal bottom street (farther, but the way the circuit actually
// runs there) — exactly the wrong-direction jog this phase removes. ---
const q0: Point = [0, 0]
const q1: Point = [100, 0]
const q2: Point = [100, 100]
const q3: Point = [0, 100]
const loopBottom: Street = [q0, q1]
const loopRight: Street = [q1, q2]
const loopTop: Street = [q2, q3]
const loopLeft: Street = [q3, q0]
// Attached at the top side's midpoint, dangling down to 5 m short of the
// bottom side — physically close to a point just above the bottom side, but
// only reachable via the top.
const danglingStub: Street = [
  [50, 100],
  [50, 5],
]
// The bottom side's own midpoint pulled 3 m inward (toward the stub's tip,
// 2 m away) — closer to the stub than to the bottom street it actually sits
// beside.
const perturbedRing: Point[] = [q0, [50, 3], q1, q2, q3]
const perturbedIdentity: Candidate = { anchorM: [0, 0], rotationRad: 0 }

describe('tryRouteLoop / buildBestEffortLoop — direction-aware snapping (Phase 11)', () => {
  it('tryRouteLoop resolves the perturbed sample onto the bottom street, ignoring the physically-closer but misaligned dangling stub', () => {
    const withStub = buildStreetGraph([loopBottom, loopRight, loopTop, loopLeft, danglingStub])
    const withoutStub = buildStreetGraph([loopBottom, loopRight, loopTop, loopLeft])

    const result = tryRouteLoop(perturbedRing, perturbedIdentity, 1, withStub, { samples: 5 })
    const baseline = tryRouteLoop(perturbedRing, perturbedIdentity, 1, withoutStub, { samples: 5 })

    expect(result).not.toBeNull()
    expect(baseline).not.toBeNull()
    // No detour up to the stub and back: same length as the stub-free
    // network, not the ~250 m round trip a plain nearest-point snap would add.
    expect(result!.lengthM).toBeCloseTo(baseline!.lengthM, 6)
    expect(result!.simple).toBe(true)
  })

  it('buildBestEffortLoop resolves the same sample onto the bottom street too, with no gaps and no inflated length', () => {
    const withStub = buildStreetGraph([loopBottom, loopRight, loopTop, loopLeft, danglingStub])
    const withoutStub = buildStreetGraph([loopBottom, loopRight, loopTop, loopLeft])

    const result = buildBestEffortLoop(perturbedRing, perturbedIdentity, 1, withStub, { samples: 5 })
    const baseline = buildBestEffortLoop(perturbedRing, perturbedIdentity, 1, withoutStub, { samples: 5 })

    expect(result.gapCount).toBe(0)
    expect(result.lengthM).toBeCloseTo(baseline.lengthM, 6)
  })

  it('a sample is treated as unresolved when only a misaligned street is within snapMaxM, not silently snapped to it', () => {
    // Only the dangling stub is nearby (no bottom street at all) — the
    // sample has a misaligned street in range and nothing aligned.
    const graph = buildStreetGraph([danglingStub])
    const p: Point = [50, 3] // 2 m from the stub's tip, well within snapMaxM
    const heading: Point = [1, 0] // the circuit's own (horizontal) direction here

    expect(graph.nearestAlignedPointM(p, heading, 30, (10 * Math.PI) / 180)).toBeNull()
    expect(graph.nearestPointM(p, 30)).not.toBeNull() // the stub is there, just misaligned
  })
})

describe('buildBestEffortLoop', () => {
  it('a fully-connected placed outline returns gapCount: 0 and gapLengthM: 0', () => {
    const anchor: Point = [1000, 800]
    const bottom: Street = [
      [800, 650],
      [1200, 650],
    ]
    const right: Street = [
      [1200, 650],
      [1200, 950],
    ]
    const top: Street = [
      [1200, 950],
      [800, 950],
    ]
    const left: Street = [
      [800, 950],
      [800, 650],
    ]
    const graph = buildStreetGraph([bottom, right, top, left])
    const rect: Point[] = [
      [-200, -150],
      [200, -150],
      [200, 150],
      [-200, 150],
    ]
    const circuitSamplesM = resample(rect, 15, true)

    const result = buildBestEffortLoop(circuitSamplesM, { anchorM: anchor, rotationRad: 0 }, 1, graph, {
      samples: 48,
      alignMaxRad: NO_ALIGN_FILTER,
    })

    expect(result.gapCount).toBe(0)
    expect(result.gapLengthM).toBe(0)
    expect(result.legs.every((l) => l.real)).toBe(true)
    expect(result.lengthM).toBeGreaterThan(1300)
    expect(result.lengthM).toBeLessThan(1500)
  })

  it('samples split across two disconnected components come back as real legs plus flanking gap legs, never null', () => {
    // Passes exactly through D, but shares no node with the triangle — so
    // walking the ring, both legs touching D (C-D and D-A) cross the
    // component boundary and come back as gaps; A-B and B-C stay real.
    const isolatedNearD: Street = [
      [-50, 100],
      [50, 100],
    ]
    const graph = buildStreetGraph([...triangle, isolatedNearD])

    const result = buildBestEffortLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })

    expect(result.legs).toHaveLength(4)
    expect(result.legs[0]!.real).toBe(true) // A-B
    expect(result.legs[1]!.real).toBe(true) // B-C
    expect(result.legs[2]!.real).toBe(false) // C-D
    expect(result.legs[3]!.real).toBe(false) // D-A
    expect(result.gapCount).toBe(2)
    const expectedGapM =
      pathLength(result.legs[2]!.points, false) + pathLength(result.legs[3]!.points, false)
    expect(result.gapLengthM).toBeCloseTo(expectedGapM, 6)
    expect(result.gapLengthM).toBeGreaterThan(0)
  })

  it('a candidate with no street anywhere near it still returns a full loop of gap legs, never throws', () => {
    const graph = buildStreetGraph(triangle)
    const farAway: Candidate = { anchorM: [1_000_000, 1_000_000], rotationRad: 0 }

    const result = buildBestEffortLoop(ring, farAway, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })

    expect(result.legs).toHaveLength(4)
    expect(result.legs.every((l) => !l.real)).toBe(true)
    expect(result.gapCount).toBe(4)
    expect(Number.isFinite(result.lengthM)).toBe(true)
  })

  it('is never rejected for length, unlike tryRouteLoop', () => {
    // Same fixture tryRouteLoop rejects for detouring past MAX_LENGTH_RATIO.
    const longSpur: Street = [
      [100, 100],
      [100, 1000],
      [0, 1000],
      [0, 100],
    ]
    const graph = buildStreetGraph([...triangle, longSpur])
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })).toBeNull()

    const result = buildBestEffortLoop(ring, identity, 1, graph, { samples: 4, alignMaxRad: NO_ALIGN_FILTER })
    expect(result.legs.every((l) => l.real)).toBe(true)
    expect(result.gapCount).toBe(0)
    expect(result.lengthM).toBeGreaterThan(1000) // far over the ring's own ~400 m perimeter
  })
})

// --- searchRoutedLoops: the same small ring, planted at real positions in a
// larger synthetic street network, so Phase 6's own coverage search finds it. ---

// A 400 × 300 rectangle, resampled densely (Phase 6's coarse search only
// considers a candidate at all once ~40% of its samples land within 10 m of
// an aligned street, so the anchors below are deliberately planted exactly on
// the coarse grid/rotation steps — the same trick match/search.test.ts's own
// "planted optimum" tests use).
const rectCorners: Point[] = [
  [-200, -150],
  [200, -150],
  [200, 150],
  [-200, 150],
]
const circuitSamplesM = resample(rectCorners, 15, true)
// Phase 12's straight-anchored seeding is orthogonal to what these synthetic
// tests exercise (connectivity/ranking/length) — an empty `ways` list makes
// `findMatchingStreetStraights` return no matches, so seeding is a no-op and
// `circuitStraight`'s value is otherwise unused.
const NO_STRAIGHT_SEED = {
  ways: [] as Street[],
  circuitStraight: { a: rectCorners[0]!, b: rectCorners[1]!, lengthM: 400 },
}

function placed(p: Point, anchor: Point): Point {
  return [p[0] + anchor[0], p[1] + anchor[1]]
}
function corners(anchor: Point): [Point, Point, Point, Point] {
  return rectCorners.map((p) => placed(p, anchor)) as [Point, Point, Point, Point]
}

/** A fully connected quad of streets around `anchor` — a real, simple loop. */
function connectedQuad(anchor: Point): Street[] {
  const [a, b, c, d] = corners(anchor)
  return [
    [a, b],
    [b, c],
    [c, d],
    [d, a],
  ]
}

/** The same quad shape, but each side pulled apart at the corners so it
 *  still scores well on street coverage without ever being routable. */
function disconnectedQuad(anchor: Point, gap = 8): Street[] {
  const [a, b, c, d] = corners(anchor)
  const shrink = (p: Point, q: Point): Street => {
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    return [
      [p[0] + ux * gap, p[1] + uy * gap],
      [q[0] - ux * gap, q[1] - uy * gap],
    ]
  }
  return [shrink(a, b), shrink(b, c), shrink(c, d), shrink(d, a)]
}

/**
 * Three real sides (a-b, b-c, c-d) plus a diagonal shortcut c-a — no direct
 * d-a side at all. Closing the loop from d back to a must retrace c-d and
 * then cut across the (short) diagonal, so the loop found here is routable
 * but never simple. `nonSimpleRing` matches this: it samples densely along
 * the three real sides but never between d and a, so every sample still has
 * a real street to snap onto (the missing side is only ever an endpoint-to-
 * endpoint closing leg, never a leg with samples stranded on open space).
 */
function nonSimpleQuad(anchor: Point): Street[] {
  const [a, b, c, d] = corners(anchor)
  return [
    [a, b],
    [b, c],
    [c, d],
    [c, a],
  ]
}
const nonSimpleRing: Point[] = (() => {
  const [a, b, c, d] = rectCorners as [Point, Point, Point, Point]
  return [
    a,
    [-67, -150],
    [67, -150],
    b,
    [200, -50],
    [200, 50],
    c,
    [67, 150],
    [-67, 150],
    d,
  ]
})()

// Both anchors planted exactly on the default 300 m coarse grid.
const REAL_ANCHOR: Point = [1200, 900]
const DECOY_ANCHOR: Point = [1200, 1800]
const BBOX = { min: [0, 0] as Point, max: [2400, 2700] as Point }

describe('searchRoutedLoops', () => {
  it('ranks a real, simple routed loop above a decoy that only scores well on coverage', () => {
    const ways = [...connectedQuad(REAL_ANCHOR), ...disconnectedQuad(DECOY_ANCHOR)]
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX, ...NO_STRAIGHT_SEED }

    const { suggestions } = drain(searchRoutedLoops(input, graph, { alignMaxRad: NO_ALIGN_FILTER }))

    expect(suggestions.length).toBeGreaterThanOrEqual(2)
    expect(suggestions[0]!.loop).toBeDefined()
    expect(suggestions[0]!.loop!.simple).toBe(true)
    const firstFallbackIndex = suggestions.findIndex((s) => !s.loop)
    expect(firstFallbackIndex).toBeGreaterThan(0)
  })

  it('a non-simple routed loop still ranks above every fallback, and reports simple: false honestly', () => {
    const ways = [...nonSimpleQuad(REAL_ANCHOR), ...disconnectedQuad(DECOY_ANCHOR)]
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = {
      circuitSamplesM: nonSimpleRing,
      scale: 1,
      index,
      bbox: BBOX,
      ...NO_STRAIGHT_SEED,
    }

    const { suggestions } = drain(searchRoutedLoops(input, graph, { alignMaxRad: NO_ALIGN_FILTER }))

    expect(suggestions[0]!.loop).toBeDefined()
    expect(suggestions[0]!.loop!.simple).toBe(false)
    expect(suggestions.slice(1).every((s) => !s.loop || !s.loop.simple)).toBe(true)
  })

  it('fills every slot with best-effort loops (Phase 10) instead of the old bare fallback, when no candidate in the pool can form a full loop', () => {
    const ways = disconnectedQuad(REAL_ANCHOR)
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX, ...NO_STRAIGHT_SEED }

    const { suggestions } = drain(searchRoutedLoops(input, graph, { alignMaxRad: NO_ALIGN_FILTER }))

    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    expect(suggestions.every((s) => !s.loop)).toBe(true)
    expect(suggestions.every((s) => s.bestEffort !== undefined)).toBe(true)
    expect(suggestions.every((s) => s.bestEffort!.gapCount > 0)).toBe(true)
  })

  it('ranks a best-effort loop below every routed one', () => {
    const ways = [...connectedQuad(REAL_ANCHOR), ...disconnectedQuad(DECOY_ANCHOR)]
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX, ...NO_STRAIGHT_SEED }

    const { suggestions } = drain(searchRoutedLoops(input, graph, { alignMaxRad: NO_ALIGN_FILTER }))

    expect(suggestions[0]!.loop).toBeDefined()
    const decoyIndex = suggestions.findIndex((s) => s.bestEffort !== undefined)
    expect(decoyIndex).toBeGreaterThan(0)
    expect(suggestions[decoyIndex]!.loop).toBeUndefined()
  })

  it('ranks two best-effort-only candidates by gapLengthM ascending', () => {
    const DECOY_ANCHOR2: Point = [300, 900]
    const ways = [...disconnectedQuad(DECOY_ANCHOR, 8), ...disconnectedQuad(DECOY_ANCHOR2, 20)]
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = {
      circuitSamplesM,
      scale: 1,
      index,
      bbox: BBOX,
      ...NO_STRAIGHT_SEED,
    }

    const { suggestions } = drain(searchRoutedLoops(input, graph, { loopCandidatePool: 24, alignMaxRad: NO_ALIGN_FILTER }))

    const bestEffortOnes = suggestions.filter((s) => s.bestEffort !== undefined)
    expect(bestEffortOnes.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < bestEffortOnes.length; i++) {
      expect(bestEffortOnes[i]!.bestEffort!.gapLengthM).toBeGreaterThanOrEqual(
        bestEffortOnes[i - 1]!.bestEffort!.gapLengthM,
      )
    }
  })

  it('progress yields are monotonic across both phases and end with done === total on the final route step', () => {
    const ways = connectedQuad(REAL_ANCHOR)
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX, ...NO_STRAIGHT_SEED }

    const { progress } = drain(searchRoutedLoops(input, graph, { alignMaxRad: NO_ALIGN_FILTER }))

    expect(progress.length).toBeGreaterThan(0)
    const search = progress.filter((p) => p.phase === 'search')
    const route = progress.filter((p) => p.phase === 'route')
    expect(search.length).toBeGreaterThan(0)
    expect(route.length).toBeGreaterThan(0)
    for (let i = 1; i < route.length; i++) {
      expect(route[i]!.done).toBeGreaterThanOrEqual(route[i - 1]!.done)
      expect(route[i]!.total).toBe(route[0]!.total)
    }
    const lastRoute = route[route.length - 1]!
    expect(lastRoute.done).toBe(lastRoute.total)
  })
})

describe('searchRoutedLoops — real Porto data', () => {
  it(
    'completes within a generous budget for all three bundled circuits and reports how many suggestions routed',
    () => {
      const network = loadStreetNetwork()
      const index = buildStreetIndex(network.ways)
      const graph = buildStreetGraph(network.ways)
      const project = portoProjection()
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

        const started = performance.now()
        const { suggestions } = drain(searchRoutedLoops(input, graph))
        const elapsedMs = performance.now() - started
        const routedCount = suggestions.filter((s) => s.loop).length
        const simpleCount = suggestions.filter((s) => s.loop?.simple).length
        const bestEffortOnes = suggestions.filter((s) => s.bestEffort)
        const gapCounts = bestEffortOnes.map((s) => s.bestEffort!.gapCount)
        const gapLengths = bestEffortOnes.map((s) => Math.round(s.bestEffort!.gapLengthM))
        // lengthM/its ratio to the circuit's own length: Phase 11's actual
        // target (see docs/specs/phase-11-straighten-best-effort-loops.md) —
        // gapCount/gapLengthM alone can rise even as this improves, since a
        // wrong-direction "real" leg becoming an honest gap shortens the
        // total route while adding to the gap tally.
        const targetLengthM = pathLength(circuit.metricCentreline, true)
        const lengths = bestEffortOnes.map((s) => Math.round(s.bestEffort!.lengthM))
        const ratios = bestEffortOnes.map((s) => (s.bestEffort!.lengthM / targetLengthM).toFixed(2))
        // Reported in the ROADMAP decision-log entry. Phase 9's crossing/
        // corridor repair raised real connectivity from 88.3% to ~95%, but as
        // of Phase 9 every bundled circuit still routed 0 — the surviving
        // blocker turned out to be Phase 8's MAX_LENGTH_RATIO cap, not
        // connectivity. Phase 10 adds a best-effort tier for exactly that
        // case: not asserting a *routed* count here on purpose (that's
        // Porto's real street layout, not a regression to fix), but the
        // best-effort tier is expected to fill every circuit's list now,
        // since it never fails.
        console.log(
          `searchRoutedLoops (real data) — ${circuit.id}: ${elapsedMs.toFixed(0)} ms, ` +
            `circuit length ${targetLengthM.toFixed(0)} m, ` +
            `${routedCount}/${suggestions.length} routed (${simpleCount} simple), ` +
            `${bestEffortOnes.length} best-effort (gaps: ${gapCounts.join(',')}; ` +
            `gap lengths m: ${gapLengths.join(',')}; ` +
            `lengths m: ${lengths.join(',')}; ratio to circuit: ${ratios.join(',')})`,
        )

        expect(suggestions.length).toBeGreaterThanOrEqual(1)
        expect(suggestions.length).toBeLessThanOrEqual(LOOP_RESULT_COUNT)
        expect(routedCount + bestEffortOnes.length).toBeGreaterThanOrEqual(1)
      }
    },
    180_000,
  )
})
