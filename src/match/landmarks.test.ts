import { describe, expect, it } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { SAMPLE_M } from '../app/proximity'
import { resample } from '../geometry/path'
import type { Point } from '../geometry/types'
import { buildStreetGraph } from '../graph'
import type { Street } from '../streets'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import { portoProjection } from '../porto'
import { searchPlacements } from './search'
import type { Candidate, Landmark, SearchInput, SearchProgress, Suggestion } from './types'
import {
  LANDMARK_SEARCH_RADIUS_M,
  buildLandmarks,
  buildSkeletonLoop,
  moveLandmark,
  resolveLandmark,
} from './landmarks'

function drainSearch(input: SearchInput): Suggestion[] {
  const gen = searchPlacements(input)
  let step: IteratorResult<SearchProgress, Suggestion[]> = gen.next()
  while (!step.done) step = gen.next()
  return step.value
}

const identity: Candidate = { anchorM: [0, 0], rotationRad: 0 }

function landmarkAt(point: Point, heading: Point): Landmark {
  return { corner: { index: 0, point, turnRad: Math.PI / 2 }, heading }
}

describe('buildLandmarks', () => {
  it('returns a plausible corner count for each bundled circuit', () => {
    for (const circuit of loadMetricCircuits()) {
      const landmarks = buildLandmarks(resample(circuit.metricCentreline, SAMPLE_M), 0)
      expect(landmarks.length).toBeGreaterThanOrEqual(5)
      expect(landmarks.length).toBeLessThanOrEqual(35)
    }
  })
})

describe('resolveLandmark', () => {
  it('resolves onto a well-aligned street exactly at the expected position', () => {
    const street: Street = [
      [-50, 0],
      [50, 0],
    ]
    const graph = buildStreetGraph([street])
    const landmark = landmarkAt([0, 0], [1, 0])
    const anchor = resolveLandmark(landmark, identity, 1, graph)
    expect(anchor.point).not.toBeNull()
    expect(anchor.node).not.toBeNull()
    expect(anchor.point![0]).toBeCloseTo(0, 1)
    expect(anchor.point![1]).toBeCloseTo(0, 1)
  })

  it('is a gap when only a misaligned street is nearby', () => {
    const street: Street = [
      [0, -50],
      [0, 50],
    ]
    const graph = buildStreetGraph([street])
    const landmark = landmarkAt([0, 0], [1, 0]) // wants east-west, street runs north-south
    const anchor = resolveLandmark(landmark, identity, 1, graph)
    expect(anchor.point).toBeNull()
    expect(anchor.node).toBeNull()
  })

  it('is a gap when a well-aligned street sits just outside the search radius', () => {
    const farM = LANDMARK_SEARCH_RADIUS_M + 30
    const street: Street = [
      [farM, 0],
      [farM + 50, 0],
    ]
    const graph = buildStreetGraph([street])
    const landmark = landmarkAt([0, 0], [1, 0])
    const anchor = resolveLandmark(landmark, identity, 1, graph, { searchRadiusM: LANDMARK_SEARCH_RADIUS_M })
    expect(anchor.point).toBeNull()
    expect(anchor.node).toBeNull()
  })
})

// A rectangular block, corners at (800,650)-(1200,650)-(1200,950)-(800,950),
// placed by `rectCandidate` from circuit-frame corners centred on its own
// centroid — the same small fixture shape earlier phases used for loop tests.
const rectCandidate: Candidate = { anchorM: [1000, 800], rotationRad: 0 }
const rectLandmarks: Landmark[] = [
  landmarkAt([-200, -150], [1, 0]), // -> placed (800, 650), matches the bottom street
  landmarkAt([200, -150], [0, 1]), // -> placed (1200, 650), matches the right street
  landmarkAt([200, 150], [1, 0]), // -> placed (1200, 950), matches the top street
  landmarkAt([-200, 150], [0, 1]), // -> placed (800, 950), matches the left street
]
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

describe('buildSkeletonLoop', () => {
  it('a fully-connected rectangle of streets resolves every landmark with gapCount 0', () => {
    const graph = buildStreetGraph([bottom, right, top, left])
    const loop = buildSkeletonLoop(rectLandmarks, rectCandidate, 1, graph)
    expect(loop.gapCount).toBe(0)
    expect(loop.legs.every((l) => l.real)).toBe(true)
    expect(loop.lengthM).toBeCloseTo(1400, 0) // 2 * (400 + 300)
  })

  it('never throws when part of the network is missing, and reports honest gaps', () => {
    // Only bottom + right exist; landmark3 (top-left corner) resolves onto an
    // isolated stub near its own expected position, disconnected from
    // bottom/right. Going around a closed loop, a genuine disconnection
    // always crosses the component boundary an even number of times (you
    // have to cross back in to return to the start) — so the minimum
    // possible honest gap count here is 2, not 1: landmark2->landmark3 and
    // landmark3->landmark0 both cross from the bottom/right component into
    // the isolated stub's own component, while landmark0->landmark1 and
    // landmark1->landmark2 stay real.
    const stub: Street = [
      [790, 945],
      [790, 955],
    ]
    const graph = buildStreetGraph([bottom, right, top, stub])
    const loop = buildSkeletonLoop(rectLandmarks, rectCandidate, 1, graph)
    expect(loop.gapCount).toBe(2)
    expect(loop.legs[0]!.real).toBe(true) // landmark0 -> landmark1, via bottom
    expect(loop.legs[1]!.real).toBe(true) // landmark1 -> landmark2, via right
    expect(loop.legs[2]!.real).toBe(false) // landmark2 -> landmark3: crosses components
    expect(loop.legs[3]!.real).toBe(false) // landmark3 -> landmark0: crosses components
    expect(loop.anchors.every((a) => a.point !== null)).toBe(true) // every landmark still resolved
  })
})

describe('moveLandmark', () => {
  it('recomputes only the two adjacent legs and updates lengthM/gapCount', () => {
    const graph = buildStreetGraph([bottom, right, top, left])
    const loop = buildSkeletonLoop(rectLandmarks, rectCandidate, 1, graph)
    expect(loop.gapCount).toBe(0)

    // Move landmark1 off the network entirely: its own two legs become gaps,
    // the other two must stay exactly the same leg objects.
    const moved = moveLandmark(loop, 1, [5000, 5000], null, graph)

    expect(moved.gapCount).toBe(2)
    expect(moved.legs[0]!.real).toBe(false) // landmark0 -> landmark1
    expect(moved.legs[1]!.real).toBe(false) // landmark1 -> landmark2
    expect(moved.legs[2]).toBe(loop.legs[2]) // landmark2 -> landmark3: untouched
    expect(moved.legs[3]).toBe(loop.legs[3]) // landmark3 -> landmark0: untouched
    expect(moved.lengthM).not.toBeCloseTo(loop.lengthM, 0)
  })

  it('moving a landmark to reconnect turns a previously-unconnected leg real', () => {
    const stub: Street = [
      [790, 945],
      [790, 955],
    ]
    const graph = buildStreetGraph([bottom, right, top, stub])
    const loop = buildSkeletonLoop(rectLandmarks, rectCandidate, 1, graph)
    expect(loop.gapCount).toBe(2)

    // Drag landmark3 onto the right street instead of the isolated stub —
    // exactly what a `graph.nearestPointM` snap on drop would resolve to.
    const resolved = graph.nearestPointM([1200, 800], 10)!
    const moved = moveLandmark(loop, 3, resolved.point, resolved.node, graph)

    expect(moved.legs[2]!.real).toBe(true) // landmark2 -> landmark3
    expect(moved.legs[3]!.real).toBe(true) // landmark3 -> landmark0
    expect(moved.gapCount).toBe(0)
    expect(moved.legs[0]).toBe(loop.legs[0]) // untouched
    expect(moved.legs[1]).toBe(loop.legs[1]) // untouched
  })
})

describe('buildLandmarks + buildSkeletonLoop — real Porto data', () => {
  it(
    'completes for all three bundled circuits at their own best candidate placement and logs corner/gap/length numbers',
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
        const best = drainSearch(input)[0]!

        const candidate: Candidate = {
          anchorM: project.toLocal(best.placement.anchor),
          rotationRad: best.placement.rotationRad,
        }
        const landmarks = buildLandmarks(resample(circuit.metricCentreline, SAMPLE_M), candidate.rotationRad)
        const started = performance.now()
        const loop = buildSkeletonLoop(landmarks, candidate, input.scale, graph)
        const elapsedMs = performance.now() - started

        const targetLengthM = circuit.lengthM
        const ratio = loop.lengthM / targetLengthM
        console.log(
          `buildSkeletonLoop (real data) — ${circuit.id}: ${elapsedMs.toFixed(0)} ms, ` +
            `${landmarks.length} corners, circuit length ${targetLengthM.toFixed(0)} m, ` +
            `skeleton length ${loop.lengthM.toFixed(0)} m (${ratio.toFixed(2)}x), ` +
            `${loop.gapCount} gaps, mean dev ${loop.meanDeviationM.toFixed(0)} m, ` +
            `max dev ${loop.maxDeviationM.toFixed(0)} m`,
        )

        expect(landmarks.length).toBeGreaterThan(0)
        expect(loop.legs.length).toBe(landmarks.length)
      }
    },
    180_000,
  )
})
