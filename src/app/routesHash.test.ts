import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatHash, parseHash } from './routesHash'

describe('routesHash', () => {
  it('formats and parses "#<circuit>/<region>/<rank>"', () => {
    expect(formatHash({ circuitId: 'hungaroring', region: 'espinho', rank: 2 })).toBe('#hungaroring/espinho/2')
    expect(parseHash('#hungaroring/espinho/2')).toEqual({ circuitId: 'hungaroring', region: 'espinho', rank: 2 })
  })

  it('round-trips', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/),
        fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/),
        fc.integer({ min: 1, max: 999 }),
        (circuitId, region, rank) => {
          expect(parseHash(formatHash({ circuitId, region, rank }))).toEqual({ circuitId, region, rank })
        },
      ),
    )
  })

  it('also accepts the hash without its leading "#"', () => {
    expect(parseHash('silverstone/porto/3')).toEqual({ circuitId: 'silverstone', region: 'porto', rank: 3 })
  })

  it.each([
    ['empty', ''],
    ['just a hash', '#'],
    ['garbage', '#!!!'],
    ['missing region and rank', '#hungaroring'],
    ['missing rank', '#hungaroring/espinho'],
    ['missing rank after slash', '#hungaroring/espinho/'],
    ['non-integer rank', '#hungaroring/espinho/1.5'],
    ['non-numeric rank', '#hungaroring/espinho/two'],
    ['zero rank', '#hungaroring/espinho/0'],
    ['negative rank', '#hungaroring/espinho/-1'],
    ['empty id', '#/espinho/2'],
    ['empty region', '#hungaroring//2'],
    ['extra segment', '#hungaroring/espinho/2/3'],
    ['whitespace', '#hungaroring /espinho/2'],
    ['huge rank', '#hungaroring/espinho/99999999999999999999'],
  ])('rejects %s', (_label, hash) => {
    expect(parseHash(hash)).toBeNull()
  })

  it('does not know whether the circuit or region exist — that is the page’s job', () => {
    expect(parseHash('#no-such-circuit/no-such-region/1')).toEqual({
      circuitId: 'no-such-circuit',
      region: 'no-such-region',
      rank: 1,
    })
  })
})
