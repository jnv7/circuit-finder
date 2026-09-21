import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { DEFAULT_BAR, passesBar } from '../route/metrics'
import { barMisses } from './barMisses'

const BAR = DEFAULT_BAR
const GOOD = {
  lengthM: 4900,
  lengthRatio: 1.1,
  meanDeviationM: 20,
  maxDeviationM: 60,
  frechetM: 80,
  retracedFraction: 0.02,
}

describe('barMisses', () => {
  it('is empty for a route inside the bar', () => {
    expect(barMisses(GOOD, BAR)).toEqual([])
  })

  it('treats a figure exactly on its limit as met', () => {
    expect(
      barMisses(
        { ...GOOD, meanDeviationM: 30, maxDeviationM: 100, lengthRatio: 0.9, retracedFraction: 0.05 },
        BAR,
      ),
    ).toEqual([])
    expect(barMisses({ ...GOOD, lengthRatio: 1.2 }, BAR)).toEqual([])
  })

  it('reports a mean deviation miss with the real figure and the limit', () => {
    expect(barMisses({ ...GOOD, meanDeviationM: 33.4 }, BAR)).toEqual(['mean 33 m, limit 30 m'])
  })

  it('reports a longest-deviation miss', () => {
    expect(barMisses({ ...GOOD, maxDeviationM: 128 }, BAR)).toEqual(['longest deviation 128 m, limit 100 m'])
  })

  it('reports a route that is too long and one that is too short', () => {
    expect(barMisses({ ...GOOD, lengthRatio: 1.31 }, BAR)).toEqual([
      'length 1.31× the circuit, allowed 0.90× to 1.20×',
    ])
    expect(barMisses({ ...GOOD, lengthRatio: 0.85 }, BAR)).toEqual([
      'length 0.85× the circuit, allowed 0.90× to 1.20×',
    ])
  })

  it('reports retracing as a percentage', () => {
    expect(barMisses({ ...GOOD, retracedFraction: 0.08 }, BAR)).toEqual([
      'retraces 8 % of its length, limit 5 %',
    ])
  })

  it('reports several misses, in a stable order', () => {
    const misses = barMisses(
      { ...GOOD, meanDeviationM: 34.8, maxDeviationM: 165.7, lengthRatio: 1.18, retracedFraction: 0.09 },
      BAR,
    )
    expect(misses).toEqual([
      'mean 35 m, limit 30 m',
      'longest deviation 166 m, limit 100 m',
      'retraces 9 % of its length, limit 5 %',
    ])
  })

  it('never lets a miss read as a tie: a just-over figure gets a decimal', () => {
    expect(barMisses({ ...GOOD, meanDeviationM: 30.2 }, BAR)).toEqual(['mean 30.2 m, limit 30 m'])
  })

  it('judges against the bar it is given, not today’s constant', () => {
    const strict = { ...BAR, meanM: 10 }
    expect(barMisses(GOOD, strict)).toEqual(['mean 20 m, limit 10 m'])
  })

  it('shows a length that only just crosses its limit with a third decimal', () => {
    expect(barMisses({ ...GOOD, lengthRatio: 1.201 }, BAR)).toEqual([
      'length 1.201× the circuit, allowed 0.90× to 1.20×',
    ])
  })

  it('reads the length band literally: 1.5× the circuit is a miss', () => {
    // The generator's own `passesBar` is lenient here (Phase 22 defect, see
    // the ROADMAP decision log of 2026-09-21); this page is not.
    expect(barMisses({ ...GOOD, lengthRatio: 1.5 }, BAR)).toHaveLength(1)
  })

  it('agrees with the generator’s own passesBar wherever the length is inside its band', () => {
    const metric = fc.record({
      lengthM: fc.constant(5000),
      lengthRatio: fc.double({ min: BAR.ratioLo, max: BAR.ratioHi, noNaN: true }),
      meanDeviationM: fc.double({ min: 0, max: 80, noNaN: true }),
      maxDeviationM: fc.double({ min: 0, max: 250, noNaN: true }),
      frechetM: fc.constant(100),
      retracedFraction: fc.double({ min: 0, max: 0.3, noNaN: true }),
    })
    fc.assert(
      fc.property(metric, (m) => {
        expect(barMisses(m, BAR).length === 0).toBe(passesBar(m, BAR))
      }),
      { numRuns: 500 },
    )
  })
})
