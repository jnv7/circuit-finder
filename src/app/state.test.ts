import { describe, it, expect } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import {
  initialState,
  loadPlacement,
  moveTo,
  rotateTo,
  selectCircuit,
  setScale,
} from './state'

const circuits = loadMetricCircuits()
const center = [-8.6291, 41.1579] as const

describe('initialState', () => {
  it('picks the first circuit, centred, unrotated, 1:1', () => {
    const s = initialState(circuits, center)
    expect(s.circuitId).toBe(circuits[0]!.id)
    expect(s.placement).toEqual({ anchor: center, rotationRad: 0, scale: 1 })
  })

  it('throws on an empty circuit list', () => {
    expect(() => initialState([], center)).toThrow()
  })
})

describe('reducers', () => {
  const base = initialState(circuits, center)

  it('are pure — the input state is untouched', () => {
    const snapshot = structuredClone(base)
    moveTo(base, [0, 0])
    rotateTo(base, 1)
    setScale(base, 2)
    selectCircuit(base, circuits, circuits[1]!.id)
    expect(base).toEqual(snapshot)
  })

  it('selectCircuit keeps the placement and swaps the id', () => {
    const next = selectCircuit(base, circuits, circuits[1]!.id)
    expect(next.circuitId).toBe(circuits[1]!.id)
    expect(next.placement).toBe(base.placement)
  })

  it('selectCircuit throws on an unknown id', () => {
    expect(() => selectCircuit(base, circuits, 'nope')).toThrow(/unknown circuit/)
  })

  it('moveTo and rotateTo set just their field', () => {
    expect(moveTo(base, [1, 2]).placement.anchor).toEqual([1, 2])
    expect(rotateTo(base, 0.5).placement.rotationRad).toBe(0.5)
  })

  it('setScale clamps to [0.5, 3]', () => {
    expect(setScale(base, 1.7).placement.scale).toBe(1.7)
    expect(setScale(base, 0.1).placement.scale).toBe(0.5)
    expect(setScale(base, 99).placement.scale).toBe(3)
  })

  it('loadPlacement swaps the circuit and applies the placement', () => {
    const placement = { anchor: [-8.5, 41.2] as const, rotationRad: 1.1, scale: 2 }
    const next = loadPlacement(base, circuits, circuits[2]!.id, placement)
    expect(next.circuitId).toBe(circuits[2]!.id)
    expect(next.placement).toEqual(placement)
    expect(next.placement.anchor).not.toBe(placement.anchor)
  })

  it('loadPlacement throws on an unknown circuit', () => {
    const placement = { anchor: [0, 0] as const, rotationRad: 0, scale: 1 }
    expect(() => loadPlacement(base, circuits, 'nope', placement)).toThrow(/unknown circuit/)
  })
})
