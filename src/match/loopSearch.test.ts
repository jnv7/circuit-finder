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
const ring: Point[] = [A, B, C, D]
const identity: Candidate = { anchorM: [0, 0], rotationRad: 0 }

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
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4 })).toBeNull()
  })

  it('a candidate whose ring crosses a gap between two disconnected components returns null', () => {
    // Passes exactly through D, but shares no node with the triangle.
    const isolatedNearD: Street = [
      [-50, 100],
      [50, 100],
    ]
    const graph = buildStreetGraph([...triangle, isolatedNearD])
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4 })).toBeNull()
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
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4 })).toBeNull()
  })

  it('a single-access side street forcing a there-and-back is accepted but flagged non-simple', () => {
    // The only way to D and back is this one spur off C.
    const shortSpur: Street = [
      [100, 100],
      [0, 100],
    ]
    const graph = buildStreetGraph([...triangle, shortSpur])
    const result = tryRouteLoop(ring, identity, 1, graph, { samples: 4 })
    expect(result).not.toBeNull()
    expect(result!.simple).toBe(false)
    // Longer than the ring's own ~400 m perimeter — the spur is walked twice.
    expect(result!.lengthM).toBeGreaterThan(400)
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

    const result = buildBestEffortLoop(ring, identity, 1, graph, { samples: 4 })

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

    const result = buildBestEffortLoop(ring, farAway, 1, graph, { samples: 4 })

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
    expect(tryRouteLoop(ring, identity, 1, graph, { samples: 4 })).toBeNull()

    const result = buildBestEffortLoop(ring, identity, 1, graph, { samples: 4 })
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
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX }

    const { suggestions } = drain(searchRoutedLoops(input, graph))

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
    const input: SearchInput = { circuitSamplesM: nonSimpleRing, scale: 1, index, bbox: BBOX }

    const { suggestions } = drain(searchRoutedLoops(input, graph))

    expect(suggestions[0]!.loop).toBeDefined()
    expect(suggestions[0]!.loop!.simple).toBe(false)
    expect(suggestions.slice(1).every((s) => !s.loop || !s.loop.simple)).toBe(true)
  })

  it('fills every slot with best-effort loops (Phase 10) instead of the old bare fallback, when no candidate in the pool can form a full loop', () => {
    const ways = disconnectedQuad(REAL_ANCHOR)
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX }

    const { suggestions } = drain(searchRoutedLoops(input, graph))

    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    expect(suggestions.every((s) => !s.loop)).toBe(true)
    expect(suggestions.every((s) => s.bestEffort !== undefined)).toBe(true)
    expect(suggestions.every((s) => s.bestEffort!.gapCount > 0)).toBe(true)
  })

  it('ranks a best-effort loop below every routed one', () => {
    const ways = [...connectedQuad(REAL_ANCHOR), ...disconnectedQuad(DECOY_ANCHOR)]
    const index = buildStreetIndex(ways, 50)
    const graph = buildStreetGraph(ways)
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX }

    const { suggestions } = drain(searchRoutedLoops(input, graph))

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
    }

    const { suggestions } = drain(searchRoutedLoops(input, graph, { loopCandidatePool: 24 }))

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
    const input: SearchInput = { circuitSamplesM, scale: 1, index, bbox: BBOX }

    const { progress } = drain(searchRoutedLoops(input, graph))

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
        }

        const started = performance.now()
        const { suggestions } = drain(searchRoutedLoops(input, graph))
        const elapsedMs = performance.now() - started
        const routedCount = suggestions.filter((s) => s.loop).length
        const simpleCount = suggestions.filter((s) => s.loop?.simple).length
        const bestEffortOnes = suggestions.filter((s) => s.bestEffort)
        const gapCounts = bestEffortOnes.map((s) => s.bestEffort!.gapCount)
        const gapLengths = bestEffortOnes.map((s) => Math.round(s.bestEffort!.gapLengthM))
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
            `${routedCount}/${suggestions.length} routed (${simpleCount} simple), ` +
            `${bestEffortOnes.length} best-effort (gaps: ${gapCounts.join(',')}; ` +
            `gap lengths m: ${gapLengths.join(',')})`,
        )

        expect(suggestions.length).toBeGreaterThanOrEqual(1)
        expect(suggestions.length).toBeLessThanOrEqual(LOOP_RESULT_COUNT)
        expect(routedCount + bestEffortOnes.length).toBeGreaterThanOrEqual(1)
      }
    },
    180_000,
  )
})
