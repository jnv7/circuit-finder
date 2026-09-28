import { describe, it, expect } from 'vitest'
import { buildQuery, candidateWays, isPitLane, parseWays } from './overpass'
import type { OsmWay } from './overpass'
import monza from './fixtures/overpass-monza.json'

const around = { lat: 45.6206, lon: 9.2894, radiusM: 3500 }

describe('buildQuery', () => {
  const q = buildQuery(around, 'Q171417')

  it('is bounded: a bbox, never a bare name search or an around filter', () => {
    expect(q).not.toMatch(/name\s*~/)
    expect(q).not.toContain('around')
    expect(q).toMatch(/way\["highway"="raceway"\]\(45\.\d+,9\.\d+,45\.\d+,9\.\d+\)/)
  })

  it('looks the relation up only among relations that contain a nearby raceway way', () => {
    expect(q).toContain('rel(bw.near)["wikidata"="Q171417"]')
    expect(q).not.toMatch(/^rel\[/m)
  })

  it('outputs the relations, the ways and every node they need', () => {
    expect(q).toContain('.rels out body;')
    expect(q).toContain('.ways out body;')
    expect(q).toMatch(/\.ways >;\s*out skel qt;/)
  })

  it('makes the box about 2×radius on each side', () => {
    const [s, w, n, e] = /\((\d+\.\d+),(\d+\.\d+),(\d+\.\d+),(\d+\.\d+)\)/.exec(q)!.slice(1).map(Number) as [number, number, number, number]
    expect((n - s) * 111_320).toBeCloseTo(7000, -1)
    expect((e - w) * 111_320 * Math.cos((45.6206 * Math.PI) / 180)).toBeCloseTo(7000, -1)
  })

  it('refuses anything that is not a Wikidata id (it is interpolated into the query)', () => {
    expect(() => buildQuery(around, 'Q1"];out;')).toThrow(/Wikidata id/)
  })
})

describe('parseWays (Monza fixture)', () => {
  const ways = parseWays(monza)

  it('reassembles every way with coordinates aligned to its node ids', () => {
    expect(ways).toHaveLength(51)
    for (const w of ways) {
      expect(w.points).toHaveLength(w.nodeIds.length)
      expect(w.nodeIds.length).toBeGreaterThanOrEqual(2)
    }
    const start = ways.find((w) => w.id === 19842206)!
    expect(start.points[0]![0]).toBeCloseTo(9.28, 1)
    expect(start.points[0]![1]).toBeCloseTo(45.62, 1)
  })

  it('marks relation members and their roles', () => {
    expect(ways.filter((w) => w.inRelation)).toHaveLength(21) // 20 lap ways + the pit lane
    expect(ways.find((w) => w.id === 38168747)!.role).toBe('pit_lane')
    expect(ways.find((w) => w.id === 179968242)!.inRelation).toBe(true)
    expect(ways.find((w) => w.id === 19982933)!.inRelation).toBe(false) // Sopraelevata Nord
  })

  it('fails loudly when a node is missing, and on a malformed response', () => {
    expect(() =>
      parseWays({ elements: [{ type: 'way', id: 1, nodes: [1, 2], tags: {} }, { type: 'node', id: 1, lat: 0, lon: 0 }] }),
    ).toThrow(/node 2/)
    expect(() => parseWays({})).toThrow(/elements/)
  })

  it('ignores ways with fewer than two nodes', () => {
    expect(parseWays({ elements: [{ type: 'way', id: 1, nodes: [1], tags: {} }, { type: 'node', id: 1, lat: 0, lon: 0 }] })).toEqual([])
  })
})

function way(id: number, o: Partial<OsmWay> = {}): OsmWay {
  return { id, nodeIds: [1, 2], points: [[0, 0], [1, 1]], tags: {}, inRelation: false, ...o }
}

describe('pit-lane exclusion', () => {
  it('excludes by relation role, by tag and by name', () => {
    expect(isPitLane(way(1, { role: 'pit_lane' }))).toBe(true)
    expect(isPitLane(way(2, { tags: { raceway: 'pit_lane' } }))).toBe(true)
    expect(isPitLane(way(3, { tags: { name: 'Pit Lane' } }))).toBe(true)
    expect(isPitLane(way(4, { tags: { name: 'pitlane' } }))).toBe(true)
    expect(isPitLane(way(5, { tags: { name: 'Pit' } }))).toBe(true)
  })

  it('excludes a name that ends in "Pit", as OSM maps Silverstone\'s National pit road', () => {
    expect(isPitLane(way(1, { tags: { name: 'Stowe Circuit Pit' } }))).toBe(true)
    expect(isPitLane(way(2, { tags: { name: 'International pit lane' } }))).toBe(true)
  })

  it('keeps a racing straight that has "Pit" in its name (Silverstone\'s start/finish straight)', () => {
    expect(isPitLane(way(1, { tags: { name: 'National Pit Straight' } }))).toBe(false)
  })

  it('does not mistake a corner name that merely contains "pit"', () => {
    expect(isPitLane(way(1, { tags: { name: 'Spitzkehre' } }))).toBe(false)
    expect(isPitLane(way(2, { tags: { name: 'Curva Alboreto' } }))).toBe(false)
  })

  it('drops pit lanes and explicitly excluded ways, keeps the rest', () => {
    const list = [way(1), way(2, { tags: { name: 'Pit Lane' } }), way(3), way(4, { role: 'pit_lane' })]
    expect(candidateWays(list).map((w) => w.id)).toEqual([1, 3])
    expect(candidateWays(list, [3]).map((w) => w.id)).toEqual([1])
  })

  it('removes exactly the fixture pit lane', () => {
    const ways = parseWays(monza)
    const kept = candidateWays(ways)
    expect(ways.length - kept.length).toBe(1)
    expect(kept.map((w) => w.id)).not.toContain(38168747)
  })
})
