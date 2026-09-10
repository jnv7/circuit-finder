import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Placement } from './app/overlay'
import type { LonLat } from './geo'
import {
  PLACEMENTS_SCHEMA_VERSION,
  getPlacement,
  makeSavedPlacement,
  parseStoredPlacements,
  placementsEqual,
  removePlacement,
  routesEqual,
  savedRoute,
  savedToPlacement,
  serialisePlacements,
  setPlacement,
  validatePlacement,
} from './placements'

const placement: Placement = { anchor: [-8.61, 41.15], rotationRad: 0.3, scale: 1.25 }

const good = () => ({
  schemaVersion: PLACEMENTS_SCHEMA_VERSION,
  circuitId: 'silverstone',
  anchor: [-8.61, 41.15],
  rotationRad: 0.3,
  scale: 1.25,
  savedAt: '2026-09-10T12:00:00.000Z',
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validatePlacement', () => {
  it('accepts a well-formed value and returns a normalised copy', () => {
    const v = validatePlacement(good())
    expect(v).toEqual(good())
    expect(v.anchor).not.toBe(good().anchor)
  })

  it.each([
    ['not an object', 42],
    ['null', null],
    ['wrong schemaVersion', { ...good(), schemaVersion: 3 }],
    ['route with one point', { ...good(), route: [[-8.6, 41.1]] }],
    ['route with a non-pair entry', { ...good(), route: [[-8.6, 41.1], [1, 2, 3]] }],
    ['route with an out-of-range coord', { ...good(), route: [[-8.6, 41.1], [999, 0]] }],
    ['blank circuitId', { ...good(), circuitId: '  ' }],
    ['missing circuitId', { ...good(), circuitId: undefined }],
    ['anchor not a pair', { ...good(), anchor: [1] }],
    ['anchor out of range', { ...good(), anchor: [200, 0] }],
    ['anchor non-finite', { ...good(), anchor: [Number.NaN, 0] }],
    ['rotation non-finite', { ...good(), rotationRad: Infinity }],
    ['scale below MIN_SCALE', { ...good(), scale: 0.1 }],
    ['scale above MAX_SCALE', { ...good(), scale: 9 }],
    ['scale non-finite', { ...good(), scale: Number.NaN }],
    ['savedAt not a date', { ...good(), savedAt: 'whenever' }],
  ])('rejects %s', (_label, value) => {
    expect(() => validatePlacement(value)).toThrow()
  })
})

const route: LonLat[] = [
  [-8.61, 41.15],
  [-8.6, 41.155],
  [-8.595, 41.15],
]

describe('makeSavedPlacement', () => {
  it('copies the placement and stamps savedAt from now', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')
    const saved = makeSavedPlacement('silverstone', placement, [], now)
    expect(saved).toEqual(good())
    expect(saved.anchor).not.toBe(placement.anchor)
  })

  it('omits a route shorter than 2 points, keeps one with 2+', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')
    expect(makeSavedPlacement('silverstone', placement, [[-8.6, 41.1]], now).route).toBeUndefined()
    const saved = makeSavedPlacement('silverstone', placement, route, now)
    expect(saved.route).toEqual(route)
    expect(saved.route).not.toBe(route)
  })
})

describe('savedToPlacement / savedRoute', () => {
  it('round-trips the placement through makeSavedPlacement', () => {
    const saved = makeSavedPlacement('silverstone', placement, [], new Date())
    expect(savedToPlacement(saved)).toEqual(placement)
  })

  it('savedRoute returns [] when absent and a copy otherwise', () => {
    expect(savedRoute(makeSavedPlacement('silverstone', placement, [], new Date()))).toEqual([])
    const saved = makeSavedPlacement('silverstone', placement, route, new Date())
    expect(savedRoute(saved)).toEqual(route)
    expect(savedRoute(saved)).not.toBe(saved.route)
  })
})

describe('routesEqual', () => {
  it('is true for identical routes, false for a moved vertex or a length change', () => {
    expect(routesEqual(route, route.map((p) => [p[0], p[1]]))).toBe(true)
    expect(routesEqual(route, [...route.slice(0, 2), [-8.59, 41.16]])).toBe(false)
    expect(routesEqual(route, route.slice(0, 2))).toBe(false)
  })
})

describe('validatePlacement — schema upgrade', () => {
  it('accepts a stored v1 record and returns it as v2 with no route', () => {
    const v1 = { ...good(), schemaVersion: 1 }
    const v = validatePlacement(v1)
    expect(v.schemaVersion).toBe(PLACEMENTS_SCHEMA_VERSION)
    expect(v.route).toBeUndefined()
  })

  it('round-trips a v2 record that carries a route', () => {
    const v = validatePlacement({ ...good(), route })
    expect(v.route).toEqual(route)
  })

  it('normalises an empty route to an absent field', () => {
    expect(validatePlacement({ ...good(), route: [] }).route).toBeUndefined()
  })
})

describe('placementsEqual', () => {
  const base: Placement = { anchor: [1, 2], rotationRad: 0.5, scale: 1 }
  it('is true for equal placements', () => {
    expect(placementsEqual(base, { anchor: [1, 2], rotationRad: 0.5, scale: 1 })).toBe(true)
  })
  it.each([
    ['anchor lon', { ...base, anchor: [1.1, 2] as const }],
    ['anchor lat', { ...base, anchor: [1, 2.1] as const }],
    ['rotation', { ...base, rotationRad: 0.6 }],
    ['scale', { ...base, scale: 1.5 }],
  ])('is false when %s differs', (_label, other) => {
    expect(placementsEqual(base, other)).toBe(false)
  })
})

describe('store ops', () => {
  const a = makeSavedPlacement('silverstone', placement, [], new Date('2026-09-10T12:00:00.000Z'))
  const b = makeSavedPlacement('hungaroring', placement, [], new Date('2026-09-10T13:00:00.000Z'))

  it('setPlacement adds without mutating', () => {
    const store = setPlacement({}, a)
    const next = setPlacement(store, b)
    expect(Object.keys(store)).toEqual(['silverstone'])
    expect(Object.keys(next).sort()).toEqual(['hungaroring', 'silverstone'])
  })

  it('setPlacement replaces the same circuit entry', () => {
    const a2 = makeSavedPlacement('silverstone', { ...placement, scale: 2 }, [], new Date())
    const next = setPlacement(setPlacement({}, a), a2)
    expect(next['silverstone']).toBe(a2)
  })

  it('removePlacement drops without mutating', () => {
    const store = setPlacement(setPlacement({}, a), b)
    const next = removePlacement(store, 'silverstone')
    expect(Object.keys(store).sort()).toEqual(['hungaroring', 'silverstone'])
    expect(Object.keys(next)).toEqual(['hungaroring'])
  })

  it('removePlacement is a no-op copy for an absent key', () => {
    const store = setPlacement({}, a)
    expect(removePlacement(store, 'nope')).toEqual(store)
  })

  it('getPlacement returns the entry or undefined', () => {
    const store = setPlacement({}, a)
    expect(getPlacement(store, 'silverstone')).toBe(a)
    expect(getPlacement(store, 'catalunya')).toBeUndefined()
  })
})

describe('parseStoredPlacements', () => {
  it('yields {} for null / bad JSON / non-object / array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseStoredPlacements(null)).toEqual({})
    expect(parseStoredPlacements('not json')).toEqual({})
    expect(parseStoredPlacements('[]')).toEqual({})
    expect(parseStoredPlacements('42')).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('keeps the good entries and drops the broken ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = JSON.stringify({
      silverstone: good(),
      hungaroring: { ...good(), scale: 99 },
    })
    const store = parseStoredPlacements(raw)
    expect(Object.keys(store)).toEqual(['silverstone'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('drops an entry whose circuitId disagrees with its key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = JSON.stringify({ catalunya: good() }) // good() is circuitId "silverstone"
    expect(parseStoredPlacements(raw)).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('round-trips through serialisePlacements', () => {
    const store = setPlacement(
      {},
      makeSavedPlacement('silverstone', placement, route, new Date('2026-09-10T12:00:00.000Z')),
    )
    expect(parseStoredPlacements(serialisePlacements(store))).toEqual(store)
  })
})
