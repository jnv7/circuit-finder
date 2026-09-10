import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Placement } from './app/overlay'
import {
  PLACEMENTS_SCHEMA_VERSION,
  getPlacement,
  makeSavedPlacement,
  parseStoredPlacements,
  placementsEqual,
  removePlacement,
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
    ['wrong schemaVersion', { ...good(), schemaVersion: 2 }],
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

describe('makeSavedPlacement', () => {
  it('copies the placement and stamps savedAt from now', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')
    const saved = makeSavedPlacement('silverstone', placement, now)
    expect(saved).toEqual(good())
    expect(saved.anchor).not.toBe(placement.anchor)
  })
})

describe('savedToPlacement', () => {
  it('round-trips through makeSavedPlacement', () => {
    const saved = makeSavedPlacement('silverstone', placement, new Date())
    expect(savedToPlacement(saved)).toEqual(placement)
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
  const a = makeSavedPlacement('silverstone', placement, new Date('2026-09-10T12:00:00.000Z'))
  const b = makeSavedPlacement('hungaroring', placement, new Date('2026-09-10T13:00:00.000Z'))

  it('setPlacement adds without mutating', () => {
    const store = setPlacement({}, a)
    const next = setPlacement(store, b)
    expect(Object.keys(store)).toEqual(['silverstone'])
    expect(Object.keys(next).sort()).toEqual(['hungaroring', 'silverstone'])
  })

  it('setPlacement replaces the same circuit entry', () => {
    const a2 = makeSavedPlacement('silverstone', { ...placement, scale: 2 }, new Date())
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
      makeSavedPlacement('silverstone', placement, new Date('2026-09-10T12:00:00.000Z')),
    )
    expect(parseStoredPlacements(serialisePlacements(store))).toEqual(store)
  })
})
