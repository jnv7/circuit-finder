import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatHash, parseHash } from './routesHash'

describe('routesHash', () => {
  it('formats and parses "#<circuit>/<rank>"', () => {
    expect(formatHash({ circuitId: 'hungaroring', rank: 2 })).toBe('#hungaroring/2')
    expect(parseHash('#hungaroring/2')).toEqual({ circuitId: 'hungaroring', rank: 2 })
  })

  it('round-trips', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/),
        fc.integer({ min: 1, max: 999 }),
        (circuitId, rank) => {
          expect(parseHash(formatHash({ circuitId, rank }))).toEqual({ circuitId, rank })
        },
      ),
    )
  })

  it('also accepts the hash without its leading "#"', () => {
    expect(parseHash('silverstone/3')).toEqual({ circuitId: 'silverstone', rank: 3 })
  })

  it.each([
    ['empty', ''],
    ['just a hash', '#'],
    ['garbage', '#!!!'],
    ['missing rank', '#hungaroring'],
    ['missing rank after slash', '#hungaroring/'],
    ['non-integer rank', '#hungaroring/1.5'],
    ['non-numeric rank', '#hungaroring/two'],
    ['zero rank', '#hungaroring/0'],
    ['negative rank', '#hungaroring/-1'],
    ['empty id', '#/2'],
    ['extra segment', '#hungaroring/2/3'],
    ['whitespace', '#hungaroring /2'],
    ['huge rank', '#hungaroring/99999999999999999999'],
  ])('rejects %s', (_label, hash) => {
    expect(parseHash(hash)).toBeNull()
  })

  it('does not know whether the circuit exists — that is the page’s job', () => {
    expect(parseHash('#no-such-circuit/1')).toEqual({ circuitId: 'no-such-circuit', rank: 1 })
  })
})
