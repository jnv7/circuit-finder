import { describe, expect, it } from 'vitest'
import { pickerSummaryLine } from './routeSummary'

describe('pickerSummaryLine', () => {
  it('formats Monza route 1 (misses the bar) with its real stored numbers', () => {
    expect(
      pickerSummaryLine({
        lengthM: 7494.479163331197,
        lengthRatio: 1.2950965135497312,
        meanDeviationM: 34.04919170857461,
        maxDeviationM: 109.93459808668081,
        frechetM: 110.32804090016556,
        retracedFraction: 0.03218801349772397,
      }),
    ).toBe("34 m on average, 110 m at most · 1.30× the circuit's length")
  })

  it("formats Sepang International Circuit's route 1 (meets the bar) with its real stored numbers", () => {
    expect(
      pickerSummaryLine({
        lengthM: 6485.9889131402915,
        lengthRatio: 1.1715168197549457,
        meanDeviationM: 24.284970721557745,
        maxDeviationM: 86.25151695391766,
        frechetM: 139.50651312825278,
        retracedFraction: 0.021509654239787897,
      }),
    ).toBe("24 m on average, 86 m at most · 1.17× the circuit's length")
  })

  it('rounds mean, max and ratio independently at the half-way point', () => {
    expect(
      pickerSummaryLine({
        lengthM: 5000,
        lengthRatio: 1.015,
        meanDeviationM: 34.5,
        maxDeviationM: 99.5,
        frechetM: 100,
        retracedFraction: 0,
      }),
    ).toBe("35 m on average, 100 m at most · 1.01× the circuit's length")
  })
})
