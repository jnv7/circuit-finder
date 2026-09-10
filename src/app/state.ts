// The whole app state: which circuit, and where the user has placed it. One
// plain object; every reducer returns a fresh value and mutates nothing.
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import type { Placement } from './overlay'

export type AppState = {
  circuitId: string
  placement: Placement
}

/** Scale multiplier bounds (Phase 2 decision: numeric input, 0.5–3.0). */
export const MIN_SCALE = 0.5
export const MAX_SCALE = 3

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** First circuit, centred on the map, unrotated, true 1:1. */
export function initialState(circuits: readonly MetricCircuit[], mapCenter: LonLat): AppState {
  const first = circuits[0]
  if (!first) throw new Error('initialState: circuit list is empty')
  return {
    circuitId: first.id,
    placement: { anchor: mapCenter, rotationRad: 0, scale: 1 },
  }
}

export function selectCircuit(
  state: AppState,
  circuits: readonly MetricCircuit[],
  id: string,
): AppState {
  if (!circuits.some((c) => c.id === id)) {
    throw new Error(`selectCircuit: unknown circuit id "${id}"`)
  }
  return { ...state, circuitId: id }
}

export function moveTo(state: AppState, anchor: LonLat): AppState {
  return { ...state, placement: { ...state.placement, anchor } }
}

export function rotateTo(state: AppState, rotationRad: number): AppState {
  return { ...state, placement: { ...state.placement, rotationRad } }
}

export function setScale(state: AppState, scale: number): AppState {
  return { ...state, placement: { ...state.placement, scale: clampScale(scale) } }
}
