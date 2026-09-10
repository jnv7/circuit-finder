import { describe, it, expect } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import {
  addRoutePoint,
  clearRoute,
  initialState,
  loadPlacement,
  moveTo,
  rotateTo,
  selectCircuit,
  setScale,
  undoRoutePoint,
} from './state'

const circuits = loadMetricCircuits()
const center = [-8.6291, 41.1579] as const

describe('initialState', () => {
  it('picks the first circuit, centred, unrotated, 1:1, no route', () => {
    const s = initialState(circuits, center)
    expect(s.circuitId).toBe(circuits[0]!.id)
    expect(s.placement).toEqual({ anchor: center, rotationRad: 0, scale: 1 })
    expect(s.route).toEqual([])
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
    addRoutePoint(base, [1, 2])
    undoRoutePoint(base)
    clearRoute(base)
    expect(base).toEqual(snapshot)
  })

  it('selectCircuit keeps the placement, swaps the id, drops the route', () => {
    const traced = addRoutePoint(base, [-8.6, 41.15])
    const next = selectCircuit(traced, circuits, circuits[1]!.id)
    expect(next.circuitId).toBe(circuits[1]!.id)
    expect(next.placement).toBe(base.placement)
    expect(next.route).toEqual([])
  })

  it('addRoutePoint / undoRoutePoint / clearRoute edit only the route', () => {
    const a = addRoutePoint(base, [1, 2])
    const b = addRoutePoint(a, [3, 4])
    expect(b.route).toEqual([[1, 2], [3, 4]])
    expect(undoRoutePoint(b).route).toEqual([[1, 2]])
    expect(clearRoute(b).route).toEqual([])
    expect(undoRoutePoint(base)).toBe(base)
    expect(b.placement).toBe(base.placement)
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

  it('loadPlacement swaps the circuit and applies the placement and route', () => {
    const placement = { anchor: [-8.5, 41.2] as const, rotationRad: 1.1, scale: 2 }
    const route = [[-8.5, 41.2], [-8.49, 41.21]] as const
    const next = loadPlacement(base, circuits, circuits[2]!.id, placement, route)
    expect(next.circuitId).toBe(circuits[2]!.id)
    expect(next.placement).toEqual(placement)
    expect(next.placement.anchor).not.toBe(placement.anchor)
    expect(next.route).toEqual(route)
    expect(next.route).not.toBe(route)
  })

  it('loadPlacement defaults to an empty route', () => {
    const placement = { anchor: [-8.5, 41.2] as const, rotationRad: 0, scale: 1 }
    expect(loadPlacement(base, circuits, circuits[0]!.id, placement).route).toEqual([])
  })

  it('loadPlacement throws on an unknown circuit', () => {
    const placement = { anchor: [0, 0] as const, rotationRad: 0, scale: 1 }
    expect(() => loadPlacement(base, circuits, 'nope', placement)).toThrow(/unknown circuit/)
  })
})
