import { describe, it, expect } from 'vitest'
import { matchBundled, normaliseName, slugId } from './names'
import type { Circuit } from '../circuits'

function circuit(id: string, name: string): Circuit {
  return {
    id,
    name,
    location: { lat: 0, lon: 0 },
    officialLengthM: 1000,
    attribution: { source: 's', license: 'l', url: 'u', retrieved: '2026-01-01' },
    centreline: [],
  }
}

const bundled = [
  circuit('hungaroring', 'Hungaroring'),
  circuit('silverstone', 'Silverstone Circuit'),
  circuit('catalunya', 'Circuit de Barcelona-Catalunya'),
  circuit('interlagos', 'Autódromo José Carlos Pace'),
  circuit('paul-ricard', 'Circuit Paul Ricard'),
]

describe('normaliseName', () => {
  it('strips accents, folds case, drops punctuation and collapses spaces', () => {
    expect(normaliseName('  Autódromo   José-Carlos  Pace! ')).toBe('autodromo jose carlos pace')
    expect(normaliseName('AUTODROMO')).toBe(normaliseName('Autódromo'))
  })
})

describe('matchBundled', () => {
  it('matches accent- and case-insensitively', () => {
    expect(matchBundled('autodromo jose carlos pace', bundled).map((c) => c.id)).toEqual(['interlagos'])
  })

  it('matches by id or by name', () => {
    expect(matchBundled('catalunya', bundled).map((c) => c.id)).toEqual(['catalunya'])
    expect(matchBundled('Hungaroring', bundled).map((c) => c.id)).toEqual(['hungaroring'])
  })

  it('matches a name that contains all the query words', () => {
    expect(matchBundled('Silverstone', bundled).map((c) => c.id)).toEqual(['silverstone'])
  })

  it('returns nothing for an unknown or empty query', () => {
    expect(matchBundled('Monza', bundled)).toEqual([])
    expect(matchBundled('   ', bundled)).toEqual([])
  })

  it('returns every candidate when the query is ambiguous', () => {
    expect(matchBundled('circuit', bundled).map((c) => c.id)).toEqual(['silverstone', 'catalunya', 'paul-ricard'])
  })

  it('lets an exact match beat a partial one', () => {
    const list = [circuit('monza', 'Monza'), circuit('monza-junior', 'Monza Junior')]
    expect(matchBundled('Monza', list).map((c) => c.id)).toEqual(['monza'])
  })
})

describe('slugId', () => {
  it('is lowercase, hyphenated and free of accents', () => {
    expect(slugId('Autódromo José Pace')).toBe('autodromo-jose-pace')
    expect(slugId('Spa-Francorchamps')).toBe('spa-francorchamps')
  })

  it('drops words that carry no identity', () => {
    expect(slugId('Monza Circuit')).toBe('monza')
    expect(slugId('Circuit de Monaco')).toBe('monaco')
  })

  it('is stable and never empty', () => {
    expect(slugId('Monza Circuit')).toBe(slugId('monza circuit'))
    expect(slugId('Circuit')).toBe('circuit')
  })
})
