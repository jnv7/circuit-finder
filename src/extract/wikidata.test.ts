import { describe, it, expect } from 'vitest'
import { chooseLengthM, parseEntities, parseSearch, searchUrl } from './wikidata'
import entitiesFixture from './fixtures/wikidata-entities.json'
import searchFixture from './fixtures/wikidata-search-monza.json'

const M = 'http://www.wikidata.org/entity/Q11573'
const KM = 'http://www.wikidata.org/entity/Q828224'
const MILE = 'http://www.wikidata.org/entity/Q253276'

type Opts = { rank?: string; start?: number; end?: number }
function length(amount: string, unit: string, o: Opts = {}) {
  const time = (year: number) => [{ snaktype: 'value', datavalue: { value: { time: `+${year}-00-00T00:00:00Z` } } }]
  return {
    mainsnak: { snaktype: 'value', datavalue: { value: { amount, unit } } },
    rank: o.rank ?? 'normal',
    ...(o.start !== undefined || o.end !== undefined
      ? {
          qualifiers: {
            ...(o.start !== undefined ? { P580: time(o.start) } : {}),
            ...(o.end !== undefined ? { P582: time(o.end) } : {}),
          },
        }
      : {}),
  }
}
const claims = (...statements: ReturnType<typeof length>[]) => ({ P2043: statements })

describe('parseSearch', () => {
  it('returns the entity ids in result order', () => {
    expect(parseSearch(searchFixture)).toEqual(['Q171417', 'Q24940439'])
  })

  it('tolerates a missing or malformed response', () => {
    expect(parseSearch({})).toEqual([])
    expect(parseSearch(null)).toEqual([])
    expect(parseSearch({ query: { search: [{ nope: 1 }, { title: 'Q1' }, { title: 'Not an id' }] } })).toEqual(['Q1'])
  })
})

describe('searchUrl', () => {
  it('restricts the name search to one class, and encodes the term', () => {
    const url = searchUrl('Spa-Francorchamps', 'Q2338524')
    expect(url).toContain('list=search')
    expect(decodeURIComponent(url)).toContain('Spa-Francorchamps haswbstatement:P31=Q2338524')
    expect(url).not.toContain(' ')
  })
})

describe('chooseLengthM', () => {
  it('drops a superseded layout (end-time qualifier)', () => {
    const c = claims(length('+3145', M, { start: 1955, end: 1972 }), length('+3337', M, { start: 2015 }))
    expect(chooseLengthM(c, 'Q1')).toBe(3337)
  })

  it('drops deprecated statements', () => {
    const c = claims(length('+9999', M, { rank: 'deprecated', start: 2020 }), length('+5000', M))
    expect(chooseLengthM(c, 'Q1')).toBe(5000)
  })

  it('lets preferred rank win over a later start', () => {
    const c = claims(length('+5000', M, { rank: 'preferred', start: 1990 }), length('+5100', M, { start: 2020 }))
    expect(chooseLengthM(c, 'Q1')).toBe(5000)
  })

  it('takes the latest start time, treating no start time as oldest', () => {
    const c = claims(length('+3328', M), length('+3337', M, { start: 2015 }), length('+3300', M, { start: 2001 }))
    expect(chooseLengthM(c, 'Q1')).toBe(3337)
  })

  it('takes the only statement, and returns undefined when there is none', () => {
    expect(chooseLengthM(claims(length('+7003', M)), 'Q1')).toBe(7003)
    expect(chooseLengthM({}, 'Q1')).toBeUndefined()
    expect(chooseLengthM(claims(length('+3145', M, { end: 1972 })), 'Q1')).toBeUndefined()
  })

  it('converts metres, kilometres and miles', () => {
    expect(chooseLengthM(claims(length('+5.793', KM)), 'Q1')).toBeCloseTo(5793, 6)
    expect(chooseLengthM(claims(length('+2.5', MILE)), 'Q1')).toBeCloseTo(4023.36, 6)
  })

  it('rejects an unknown unit, naming the entity', () => {
    expect(() => chooseLengthM(claims(length('+5', 'http://www.wikidata.org/entity/Q3710')), 'Q42')).toThrow(/Q42.*unit/)
  })
})

describe('parseEntities', () => {
  const tracks = parseEntities(entitiesFixture)

  it('keeps racetracks with a coordinate and a length', () => {
    expect(tracks.map((t) => t.id).sort()).toEqual(['Q171390', 'Q171400', 'Q171417', 'Q172851'])
    const monza = tracks.find((t) => t.id === 'Q171417')!
    expect(monza.label).toBe('Monza Circuit')
    expect(monza.lengthM).toBe(5793)
    expect(monza.lonLat[0]).toBeCloseTo(9.2894, 3)
    expect(monza.lonLat[1]).toBeCloseTo(45.6206, 3)
  })

  it('accepts a street circuit and picks its current layout', () => {
    expect(tracks.find((t) => t.id === 'Q171400')!.lengthM).toBe(3337)
  })

  // Real entities found live this session: both correctly classified as a
  // street circuit with a real coordinate, but Wikidata has no P2043
  // (official length) statement for either — the entity itself is still
  // worth keeping, with --official-length-m required to fill the gap.
  it('keeps a correctly-classified racetrack that has a coordinate but no length (Marina Bay Street Circuit)', () => {
    const marinaBay = tracks.find((t) => t.id === 'Q171390')!
    expect(marinaBay).toBeDefined()
    expect(marinaBay.label).toBe('Marina Bay Street Circuit')
    expect(marinaBay.lengthM).toBeUndefined()
    expect(marinaBay.lonLat[0]).toBeCloseTo(103.864147, 5)
    expect(marinaBay.lonLat[1]).toBeCloseTo(1.291403, 5)
  })

  it('filters out layouts (no coordinate) and places (not a racetrack)', () => {
    expect(tracks.map((t) => t.id)).not.toContain('Q66712033')
    expect(tracks.map((t) => t.id)).not.toContain('Q235')
  })

  it('returns nothing for a malformed response', () => {
    expect(parseEntities({})).toEqual([])
    expect(parseEntities('x')).toEqual([])
  })
})
