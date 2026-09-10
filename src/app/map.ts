// Leaflet glue: build the Porto map, hold the AppState, and on every change
// recompute the overlay and swap the polylines. All the real math lives in the
// pure modules (`overlay`, `rotate`, `state`); this file only wires Leaflet
// pointer events to reducers and back.
import L from 'leaflet'
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import { overlayLatLngs, readout } from './overlay'
import { bearingFromDrag, handlePixel } from './rotate'
import type { AppState } from './state'
import { initialState, moveTo, rotateTo, selectCircuit, setScale } from './state'
import { bind, renderControls, updateReadout } from '../ui/controls'

/** Fixed initial view (Phase 2 decision; tune here only). */
export const PORTO_CENTER: LonLat = [-8.6291, 41.1579]
export const PORTO_ZOOM = 14

/** Screen distance from the anchor to the rotate handle. */
const HANDLE_PIXEL_RADIUS = 90

const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const toLatLng = ([lon, lat]: LonLat): L.LatLng => L.latLng(lat, lon)

export type MapApp = { destroy(): void }

export function createMapApp(container: HTMLElement, circuits: readonly MetricCircuit[]): MapApp {
  if (circuits.length === 0) throw new Error('createMapApp: no circuits')

  container.classList.add('circuit-finder')
  const mapEl = document.createElement('div')
  mapEl.className = 'map'
  const panelEl = document.createElement('div')
  panelEl.className = 'panel'
  container.append(mapEl, panelEl)

  const map = L.map(mapEl, { zoomControl: true }).setView(
    toLatLng(PORTO_CENTER),
    PORTO_ZOOM,
  )
  L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map)

  const circuitById = (id: string): MetricCircuit =>
    circuits.find((c) => c.id === id) ?? circuits[0]!

  // Circuit-geometry attribution, alongside the tile attribution.
  const geoAttr = circuits[0]!.attribution
  map.attributionControl.addAttribution(
    `Circuit geometry: <a href="${geoAttr.url}">${geoAttr.source}</a> (${geoAttr.license})`,
  )

  let state: AppState = initialState(circuits, PORTO_CENTER)
  let rotating = false

  // Overlay layers: a fat invisible drag target under a thin visible centreline.
  const dragTarget = L.polyline([], {
    weight: 22,
    opacity: 0,
    interactive: true,
    bubblingMouseEvents: false,
  }).addTo(map)
  const centreLine = L.polyline([], {
    weight: 3,
    opacity: 0.85,
    color: '#e10600',
    interactive: false,
  }).addTo(map)
  const handle = L.marker(toLatLng(state.placement.anchor), {
    draggable: true,
    keyboard: false,
    icon: L.divIcon({ className: 'rotate-handle', iconSize: [18, 18] }),
    zIndexOffset: 1000,
  }).addTo(map)

  function render({ repositionHandle = true }: { repositionHandle?: boolean } = {}): void {
    const circuit = circuitById(state.circuitId)
    const ring = overlayLatLngs(circuit, state.placement).map(toLatLng)
    const closed = ring.length > 0 ? [...ring, ring[0]!] : ring
    dragTarget.setLatLngs(closed)
    centreLine.setLatLngs(closed)

    if (repositionHandle) {
      const centerPx = map.latLngToContainerPoint(toLatLng(state.placement.anchor))
      const hp = handlePixel([centerPx.x, centerPx.y], state.placement.rotationRad, HANDLE_PIXEL_RADIUS)
      handle.setLatLng(map.containerPointToLatLng(L.point(hp[0], hp[1])))
    }

    const { lapM, straightM } = readout(circuit, state.placement.scale)
    updateReadout(panelEl, lapM, straightM)
  }

  function renderPanel(): void {
    panelEl.innerHTML = renderControls({
      circuits,
      selectedId: state.circuitId,
      scale: state.placement.scale,
    })
    disposeControls?.()
    disposeControls = bind(panelEl, {
      onSelectCircuit(id) {
        state = selectCircuit(state, circuits, id)
        renderPanel()
        render()
      },
      onScaleChange(scale) {
        state = setScale(state, scale)
        render()
      },
    })
  }

  let disposeControls: (() => void) | undefined
  renderPanel()
  render()

  // --- Move: drag anywhere on the overlay ------------------------------------
  let moveFrom: { pointer: L.LatLng; anchor: LonLat } | null = null

  const onOverlayDown = (e: L.LeafletMouseEvent): void => {
    moveFrom = { pointer: e.latlng, anchor: state.placement.anchor }
    map.dragging.disable()
    L.DomEvent.stop(e)
  }
  const onMapMove = (e: L.LeafletMouseEvent): void => {
    if (!moveFrom) return
    const dLon = e.latlng.lng - moveFrom.pointer.lng
    const dLat = e.latlng.lat - moveFrom.pointer.lat
    state = moveTo(state, [moveFrom.anchor[0] + dLon, moveFrom.anchor[1] + dLat])
    render()
  }
  const onMapUp = (): void => {
    if (!moveFrom) return
    moveFrom = null
    map.dragging.enable()
  }
  dragTarget.on('mousedown', onOverlayDown)
  map.on('mousemove', onMapMove)
  map.on('mouseup', onMapUp)

  // --- Rotate: drag the handle around the anchor ----------------------------
  const onHandleDrag = (): void => {
    rotating = true
    const centerPx = map.latLngToContainerPoint(toLatLng(state.placement.anchor))
    const handlePx = map.latLngToContainerPoint(handle.getLatLng())
    state = rotateTo(state, bearingFromDrag([centerPx.x, centerPx.y], [handlePx.x, handlePx.y]))
    render({ repositionHandle: false })
  }
  const onHandleUp = (): void => {
    rotating = false
    render()
  }
  handle.on('drag', onHandleDrag)
  handle.on('dragend', onHandleUp)

  // Keep the handle glued to its orbit as the map pans/zooms.
  const onViewChange = (): void => {
    if (!rotating) render()
  }
  map.on('move zoom', onViewChange)

  return {
    destroy(): void {
      disposeControls?.()
      dragTarget.off()
      handle.off()
      map.off()
      map.remove()
      container.replaceChildren()
      container.classList.remove('circuit-finder')
    },
  }
}
