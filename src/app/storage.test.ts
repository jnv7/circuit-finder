// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { makeSavedPlacement, setPlacement } from '../placements'
import { STORAGE_KEY, loadPlacements, savePlacements } from './storage'

const saved = (circuitId: string) =>
  makeSavedPlacement(
    circuitId,
    { anchor: [-8.61, 41.15], rotationRad: 0.2, scale: 1.5 },
    [],
    new Date('2026-09-10T12:00:00.000Z'),
  )

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('storage', () => {
  it('uses exactly the circuit-finder/placements key', () => {
    expect(STORAGE_KEY).toBe('circuit-finder/placements')
  })

  it('round-trips a store through save then load', () => {
    const store = setPlacement(setPlacement({}, saved('silverstone')), saved('hungaroring'))
    savePlacements(store)
    expect(loadPlacements()).toEqual(store)
  })

  it('returns {} and does not throw for a pre-seeded corrupt value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, '{ not json')
    expect(() => loadPlacements()).not.toThrow()
    expect(loadPlacements()).toEqual({})
  })

  it('swallows a write failure with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => savePlacements(setPlacement({}, saved('silverstone')))).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
