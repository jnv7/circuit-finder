// Leaflet glue: build the Porto map, hold the AppState, and on every change
// recompute the overlay + its street-proximity colouring and swap the
// polylines. All the real math lives in the pure modules (`overlay`, `rotate`,
// `state`, `proximity`, `streets`); this file only wires Leaflet pointer events
// to reducers and back, and coalesces re-renders through requestAnimationFrame.
import L from 'leaflet'
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import { PORTO_CENTER, PORTO_ZOOM, portoProjection } from '../porto'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import { overlayLatLngs, readout } from './overlay'
import { LEVELS, lapProximity, proximityColor, quantize } from './proximity'
import { bearingFromDrag, handlePixel } from './rotate'
import type { AppState } from './state'
import { initialState, moveTo, rotateTo, selectCircuit, setScale } from './state'
import { bind, renderControls, updateReadout } from '../ui/controls'

export { PORTO_CENTER, PORTO_ZOOM }

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

  const map = L.map(mapEl, { zoomControl: true }).setView(toLatLng(PORTO_CENTER), PORTO_ZOOM)
  L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map)

  const circuitById = (id: string): MetricCircuit => circuits.find((c) => c.id === id) ?? circuits[0]!

  // Circuit-geometry attribution, alongside the tile attribution. The bundled
  // street network is the same OSM/ODbL source, so one credit covers both.
  const geoAttr = circuits[0]!.attribution
  map.attributionControl.addAttribution(
    `Circuit & street geometry: <a href="${geoAttr.url}">${geoAttr.source}</a> (${geoAttr.license})`,
  )

  // --- Street network: load, index, draw the faint reference layer ----------
  const project = portoProjection()
  const network = loadStreetNetwork()
  const streetIndex = buildStreetIndex(network.ways)
  const streetLatLngs: L.LatLngExpression[][] = network.ways.map((way) =>
    way.map((p) => toLatLng(project.toLonLat(p))),
  )
  const streetLayer = L.polyline(streetLatLngs, {
    weight: 1,
    opacity: 0.5,
    color: '#8a8a8a',
    interactive: false,
  }).addTo(map)

  let state: AppState = initialState(circuits, PORTO_CENTER)
  let showStreets = true
  let rotating = false

  // Overlay layers: a fat invisible drag target under LEVELS coloured
  // centreline polylines (one per proximity bucket).
  const dragTarget = L.polyline([], {
    weight: 22,
    opacity: 0,
    interactive: true,
    bubblingMouseEvents: false,
  }).addTo(map)
  const buckets: L.Polyline[] = Array.from({ length: LEVELS }, (_, q) =>
    L.polyline([], {
      weight: 4,
      opacity: 0.9,
      color: proximityColor((q + 0.5) / LEVELS),
      interactive: false,
    }).addTo(map),
  )
  const handle = L.marker(toLatLng(state.placement.anchor), {
    draggable: true,
    keyboard: false,
    icon: L.divIcon({ className: 'rotate-handle', iconSize: [18, 18] }),
    zIndexOffset: 1000,
  }).addTo(map)

  function render({ repositionHandle = true }: { repositionHandle?: boolean } = {}): void {
    const circuit = circuitById(state.circuitId)
    const ringLonLat = overlayLatLngs(circuit, state.placement)
    const ring = ringLonLat.map(toLatLng)

    const closed = ring.length > 0 ? [...ring, ring[0]!] : ring
    dragTarget.setLatLngs(closed)

    // Proximity colouring: project the ring into the Porto frame, score each
    // segment, and route each segment into its colour bucket.
    const metricRing = ringLonLat.map((c) => project.toLocal(c))
    const { segments, nearFraction } = lapProximity(metricRing, streetIndex)
    const perBucket: L.LatLng[][][] = Array.from({ length: LEVELS }, () => [])
    for (let i = 0; i < segments.length; i++) {
      const q = quantize(segments[i]!.coverage)
      perBucket[q]!.push([ring[i]!, ring[(i + 1) % ring.length]!])
    }
    for (let q = 0; q < LEVELS; q++) buckets[q]!.setLatLngs(perBucket[q]!)

    if (repositionHandle) {
      const centerPx = map.latLngToContainerPoint(toLatLng(state.placement.anchor))
      const hp = handlePixel(
        [centerPx.x, centerPx.y],
        state.placement.rotationRad,
        HANDLE_PIXEL_RADIUS,
      )
      handle.setLatLng(map.containerPointToLatLng(L.point(hp[0], hp[1])))
    }

    const { lapM, straightM } = readout(circuit, state.placement.scale)
    updateReadout(panelEl, { lapM, straightM, nearFraction })
  }

  // rAF-coalesced re-render: pointer events schedule a frame instead of
  // rendering synchronously.
  let frame: number | null = null
  let pendingRepositionHandle = true
  function scheduleRender(opts: { repositionHandle?: boolean } = {}): void {
    if (opts.repositionHandle === false) pendingRepositionHandle = false
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      const repositionHandle = pendingRepositionHandle
      pendingRepositionHandle = true
      render({ repositionHandle })
    })
  }

  function renderPanel(): void {
    panelEl.innerHTML = renderControls({
      circuits,
      selectedId: state.circuitId,
      scale: state.placement.scale,
      showStreets,
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
      onToggleStreets(show) {
        showStreets = show
        if (show) streetLayer.addTo(map)
        else streetLayer.remove()
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
    scheduleRender()
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
    scheduleRender({ repositionHandle: false })
  }
  const onHandleUp = (): void => {
    rotating = false
    scheduleRender()
  }
  handle.on('drag', onHandleDrag)
  handle.on('dragend', onHandleUp)

  // Keep the handle glued to its orbit as the map pans/zooms.
  const onViewChange = (): void => {
    if (!rotating) scheduleRender()
  }
  map.on('move zoom', onViewChange)

  return {
    destroy(): void {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
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
