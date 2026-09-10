// The whole app state: which circuit, and where the user has placed it. One
// plain object; every reducer returns a fresh value and mutates nothing.
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import type { Placement } from './overlay'

export type AppState = {
  circuitId: string
  placement: Placement
  /** The hand-traced running route: ordered [lon, lat] vertices (Phase 5). */
  route: LonLat[]
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
    route: [],
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
  // A traced route belongs to one circuit placement; changing circuit drops it.
  return { ...state, circuitId: id, route: [] }
}

/**
 * Put a saved placement on screen: swap to its circuit and apply its placement
 * wholesale. Throws if `circuitId` is not a bundled circuit (the caller checks
 * first and shows a message). The `Placement` is passed in already decoded from
 * the stored form — `state.ts` stays free of the `placements` module.
 */
export function loadPlacement(
  state: AppState,
  circuits: readonly MetricCircuit[],
  circuitId: string,
  placement: Placement,
  route: readonly LonLat[] = [],
): AppState {
  if (!circuits.some((c) => c.id === circuitId)) {
    throw new Error(`loadPlacement: unknown circuit id "${circuitId}"`)
  }
  return {
    ...state,
    circuitId,
    placement: {
      anchor: [placement.anchor[0], placement.anchor[1]],
      rotationRad: placement.rotationRad,
      scale: placement.scale,
    },
    route: route.map((p) => [p[0], p[1]] as LonLat),
  }
}

/** Append a vertex to the traced route. */
export function addRoutePoint(state: AppState, p: LonLat): AppState {
  return { ...state, route: [...state.route, [p[0], p[1]]] }
}

/** Remove the last traced vertex (no-op on an empty route). */
export function undoRoutePoint(state: AppState): AppState {
  if (state.route.length === 0) return state
  return { ...state, route: state.route.slice(0, -1) }
}

/** Discard the whole traced route. */
export function clearRoute(state: AppState): AppState {
  if (state.route.length === 0) return state
  return { ...state, route: [] }
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
