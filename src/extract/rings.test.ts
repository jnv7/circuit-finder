import { describe, it, expect } from 'vitest'
import { EQUIVALENT_M, PICK_MARGIN, collapseEquivalent, findRings, pickRing, rankRings, sameLap } from './rings'
import type { RingCandidate } from './rings'
import { candidateWays, parseWays } from './overpass'
import type { OsmWay } from './overpass'
import monza from './fixtures/overpass-monza.json'

const LAT0 = 45
const M_PER_DEG = 111_320
/** A [lon, lat] point `x` metres east and `y` metres north of an arbitrary origin. */
const pt = (x: number, y: number): [number, number] => [x / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + y / M_PER_DEG]

let nextNode = 1
const nodeIdsByKey = new Map<string, number>()
/** Node id for a named place, so ways that name the same place share the OSM node. */
const node = (key: string): number => {
  if (!nodeIdsByKey.has(key)) nodeIdsByKey.set(key, nextNode++)
  return nodeIdsByKey.get(key)!
}

type Spot = readonly [string, number, number]
function way(id: number, spots: readonly Spot[], extra: Partial<OsmWay> = {}): OsmWay {
  return {
    id,
    nodeIds: spots.map(([k]) => node(k)),
    points: spots.map(([, x, y]) => pt(x, y)),
    tags: {},
    inRelation: false,
    ...extra,
  }
}

// A 1000 m × 500 m rectangle, 3000 m round, corners A B C D.
const A: Spot = ['A', 0, 0]
const B: Spot = ['B', 1000, 0]
const C: Spot = ['C', 1000, 500]
const D: Spot = ['D', 0, 500]

/** Ring lengths, ascending. Compared with `near`: the projection is not the test's own flat-earth metres. */
function lengths(rings: readonly RingCandidate[]): number[] {
  return rings.map((r) => r.lengthM).sort((a, b) => a - b)
}

/** Within 1 %. */
const near = (actual: number | undefined, expected: number): void => {
  expect(actual).toBeGreaterThan(expected * 0.99)
  expect(actual).toBeLessThan(expected * 1.01)
}

describe('findRings', () => {
  it('finds a single closed way as one ring, without repeating the first point', () => {
    const rings = findRings([way(1, [A, B, C, D, A])])
    expect(rings).toHaveLength(1)
    expect(rings[0]!.points).toHaveLength(4)
    near(rings[0]!.lengthM, 3000)
    expect(rings[0]!.wayIds).toEqual([1])
    expect(rings[0]!.bridgedGapsM).toEqual([])
  })

  it('assembles a ring split across several ways in any order and direction', () => {
    const ways = [way(30, [D, C]), way(10, [B, A]), way(40, [A, D]), way(20, [B, C])]
    const rings = findRings(ways)
    expect(rings).toHaveLength(1)
    near(rings[0]!.lengthM, 3000)
    expect(rings[0]!.wayIds.slice().sort()).toEqual([10, 20, 30, 40])
    expect(rings[0]!.points).toHaveLength(4)
  })

  it('splits a way at a junction in its middle', () => {
    // One long way runs A→B→C→D and a second closes it D→A; a third way B→E→F→B is a side loop
    // that meets the first only at B, a node in the middle of way 1.
    const E: Spot = ['E', 1200, -300]
    const F: Spot = ['F', 1400, -100]
    const rings = findRings([way(1, [A, B, C, D]), way(2, [D, A]), way(3, [B, E, F, B])])
    expect(rings).toHaveLength(2)
    const [side, lap] = rings.slice().sort((a, b) => a.lengthM - b.lengthM) as [RingCandidate, RingCandidate]
    expect(side.wayIds).toEqual([3])
    near(lap.lengthM, 3000)
    expect(lap.wayIds.slice().sort()).toEqual([1, 2])
  })

  it('finds each of two overlapping layouts that share a section', () => {
    // Shared straight A→B; two ways home from B: a short one via C and a long one via a detour.
    const G: Spot = ['G', 1000, 1500]
    const H: Spot = ['H', 0, 1500]
    const shared = way(1, [A, B])
    const short = way(2, [B, C, D, A])
    const long = way(3, [B, G, H, A])
    const rings = findRings([shared, short, long])
    // Theta graph: three cycles — short lap, long lap, and short-plus-long.
    expect(rings).toHaveLength(3)
    const withShared = rings.filter((r) => r.wayIds.includes(1))
    expect(withShared).toHaveLength(2)
    const [shortLap, longLap] = lengths(withShared)
    near(shortLap, 3000)
    near(longLap, 5000)
  })

  it('never joins two loops that touch at one point into a figure-eight', () => {
    const K: Spot = ['K', 3000, 0]
    const L: Spot = ['L', 3000, 500]
    // Two loops sharing only node B.
    const rings = findRings([way(10, [B, K, L, B]), way(11, [B, C, D, A, B])])
    expect(rings).toHaveLength(2)
    for (const r of rings) expect(r.wayIds).toHaveLength(1)
  })

  it('does not treat a dead-end spur as part of a ring', () => {
    const spur = way(2, [B, ['S', 1500, 0]])
    const rings = findRings([way(1, [A, B, C, D, A]), spur])
    expect(rings).toHaveLength(1)
    expect(rings[0]!.wayIds).toEqual([1])
  })

  it('bridges a 1–5 m gap between ways that share no node, and reports it', () => {
    const near: Spot = ['B2', 1003, 0] // 3 m from B, a different OSM node
    const rings = findRings([way(1, [A, B]), way(2, [near, C, D, A])])
    expect(rings).toHaveLength(1)
    expect(rings[0]!.bridgedGapsM).toHaveLength(1)
    expect(rings[0]!.bridgedGapsM[0]).toBeCloseTo(3, 0)
  })

  it('does not bridge a 50 m gap', () => {
    const far: Spot = ['B3', 1050, 0]
    expect(findRings([way(1, [A, B]), way(2, [far, C, D, A])])).toEqual([])
  })

  it('throws, loudly, when there are more cycles than the cap', () => {
    // A ladder of n cells has many simple cycles (every pair of rungs closes one).
    const rungs = 8
    const ways: OsmWay[] = []
    let id = 1
    for (let i = 0; i < rungs; i++) {
      ways.push(way(id++, [[`t${i}`, i * 100, 0], [`b${i}`, i * 100, 100]]))
      if (i > 0) {
        ways.push(way(id++, [[`t${i - 1}`, (i - 1) * 100, 0], [`t${i}`, i * 100, 0]]))
        ways.push(way(id++, [[`b${i - 1}`, (i - 1) * 100, 100], [`b${i}`, i * 100, 100]]))
      }
    }
    expect(findRings(ways).length).toBe(28) // C(8, 2) — sanity: the ladder itself is searchable
    expect(() => findRings(ways, 10)).toThrow(/candidate laps/)
  })

  it('a pit lane that would create a shorter false lap is gone once pit lanes are dropped', () => {
    // Pit lane shortcuts the far side of the rectangle, C→D.
    const P: Spot = ['P', 500, 400]
    const ways = [
      way(1, [A, B]),
      way(2, [B, C]),
      way(3, [C, D]),
      way(4, [D, A]),
      way(5, [C, P, D], { tags: { name: 'Pit Lane' } }),
    ]
    expect(findRings(ways)).toHaveLength(3) // main lap, pit-shortcut lap, and the pit/straight loop
    const rings = findRings(candidateWays(ways))
    expect(rings).toHaveLength(1)
    expect(rings[0]!.wayIds).not.toContain(5)
  })
})

describe('rankRings and pickRing', () => {
  const ring = (lengthM: number, over: Partial<RingCandidate> = {}): RingCandidate => ({
    wayIds: [1],
    points: [],
    lengthM,
    bridgedGapsM: [],
    allInRelation: false,
    ...over,
  })

  it('ranks by closeness to the official length', () => {
    const ranked = rankRings([ring(5800), ring(5100), ring(4000)], 5000)
    expect(ranked.map((r) => r.lengthM)).toEqual([5100, 5800, 4000])
    expect(ranked[0]!.errorRatio).toBeCloseTo(0.02, 6)
  })

  it('picks a ring that is inside the tolerance with a clear margin', () => {
    const result = pickRing(rankRings([ring(5100), ring(4000), ring(7000)], 5000))
    expect(result.kind).toBe('picked')
  })

  it('is ambiguous when two rings are within the margin of each other', () => {
    const result = pickRing(rankRings([ring(5100), ring(5000 * (1 + 0.02 + PICK_MARGIN / 2))], 5000))
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.top).toHaveLength(2)
  })

  it('finds nothing when no ring is within the tolerance', () => {
    const result = pickRing(rankRings([ring(3000), ring(8000)], 5000))
    expect(result.kind).toBe('none')
    if (result.kind === 'none') expect(result.reason).toMatch(/40\.0% off/)
  })

  it('finds nothing when there are no rings at all', () => {
    expect(pickRing([]).kind).toBe('none')
  })

  it('breaks a near-tie in favour of the one ring made only of relation members, and says so', () => {
    const ranked = rankRings([ring(5010, { allInRelation: true }), ring(5060), ring(4950)], 5000)
    const result = pickRing(ranked)
    expect(result.kind).toBe('picked')
    if (result.kind === 'picked') expect(result.note).toMatch(/relation/)
  })

  it('does not break a near-tie when the closest ring is not a relation member', () => {
    expect(pickRing(rankRings([ring(5010), ring(5060, { allInRelation: true })], 5000)).kind).toBe('ambiguous')
  })

  it('does not break a near-tie when several rings are relation members', () => {
    const ranked = rankRings([ring(5010, { allInRelation: true }), ring(5060, { allInRelation: true })], 5000)
    expect(pickRing(ranked).kind).toBe('ambiguous')
  })
})

describe('sameLap and collapseEquivalent', () => {
  /** A 1000 × 500 m rectangle shifted north by `dy` metres, as one closed way. */
  const loop = (id: number, dy: number, key = `L${id}`): RingCandidate =>
    findRings([way(id, ([[0, 0], [1000, 0], [1000, 500], [0, 500], [0, 0]] as const).map(([x, y], i) => [`${key}-${i % 4}`, x, y + dy] as Spot).map((s, i, all) => (i === all.length - 1 ? [all[0]![0], s[1], s[2]] : s) as Spot))])[0]!

  it('treats two rings that stay within the tolerance of each other as one lap', () => {
    expect(sameLap(loop(1, 0), loop(2, EQUIVALENT_M / 2))).toBe(true)
  })

  it('keeps rings that part company by more than the tolerance apart', () => {
    expect(sameLap(loop(1, 0), loop(2, EQUIVALENT_M * 2))).toBe(false)
  })

  it('is symmetric, and never equates a degenerate ring with anything', () => {
    const a = loop(1, 0)
    const b = loop(2, 30)
    expect(sameLap(a, b)).toBe(sameLap(b, a))
    expect(sameLap({ ...a, points: [] }, a)).toBe(false)
  })

  it('collapses the twins of the best ring and counts them; a ring beyond the margin is untouched', () => {
    const ranked = rankRings([loop(1, 0), loop(2, 20), loop(3, 30), { ...loop(4, 500), lengthM: 3000 * 1.5 }], 3000)
    const distinct = collapseEquivalent(ranked)
    expect(distinct).toHaveLength(2)
    expect(distinct[0]!.equivalentCount).toBe(2)
    expect(distinct[1]!.lengthM).toBeCloseTo(4500, 6)
  })

  it('prefers a relation-only twin as the representative of its group', () => {
    const ranked = rankRings([loop(1, 0), { ...loop(2, 20), allInRelation: true }], 3000)
    const [only] = collapseEquivalent(ranked)
    expect(only!.allInRelation).toBe(true)
    expect(only!.equivalentCount).toBe(1)
  })

  it('lets pickRing choose despite near-identical rings, and says how many it collapsed', () => {
    const result = pickRing(rankRings([loop(1, 0), loop(2, 20), loop(3, 40)], 3000))
    expect(result.kind).toBe('picked')
    if (result.kind === 'picked') expect(result.note).toMatch(/2 other ring\(s\) follow the same lap/)
  })

  it('still refuses when two genuinely different laps are equally close', () => {
    expect(pickRing(rankRings([loop(1, 0), loop(2, EQUIVALENT_M * 3)], 3000)).kind).toBe('ambiguous')
  })
})

describe('Monza fixture (real OSM data)', () => {
  const ways = candidateWays(parseWays(monza))
  const ranked = rankRings(findRings(ways), 5793)
  const result = pickRing(ranked)

  it('yields the Grand Prix ring — not the banked oval and not the union of layouts', () => {
    expect(result.kind).toBe('picked')
    if (result.kind !== 'picked') return
    expect(Math.abs(result.ring.lengthM - 5793)).toBeLessThan(10)
    expect(result.ring.wayIds).toHaveLength(20)
    expect(result.ring.allInRelation).toBe(true)
    // None of the Sopraelevata (banked oval) or the Pirelli/junior ways.
    for (const id of [19982933, 19983025, 725687994, 34404709, 193475050]) expect(result.ring.wayIds).not.toContain(id)
  })

  it('collapses the chicane variants (rings 0.4% and 0.7% off) into the same lap instead of calling it ambiguous', () => {
    if (result.kind !== 'picked') throw new Error('expected a pick')
    expect(ranked[1]!.errorRatio).toBeLessThan(PICK_MARGIN) // a near-equal ring exists...
    expect(result.note).toMatch(/follow the same lap/) // ...and it is the same lap
  })

  it('returns a valid open ring', () => {
    if (result.kind !== 'picked') throw new Error('expected a pick')
    const { points } = result.ring
    expect(points.length).toBeGreaterThan(20)
    expect(points[0]).not.toEqual(points[points.length - 1])
  })
})
