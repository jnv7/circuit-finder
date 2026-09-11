// Leaflet glue: build the Porto map, hold the AppState, and on every change
// recompute the overlay + its street-proximity colouring and swap the
// polylines. All the real math lives in the pure modules (`overlay`, `rotate`,
// `state`, `proximity`, `streets`); this file only wires Leaflet pointer events
// to reducers and back, and coalesces re-renders through requestAnimationFrame.
import L from 'leaflet'
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import type { Point } from '../geometry/types'
import { resample } from '../geometry/path'
import { PORTO_CENTER, PORTO_ZOOM, portoProjection } from '../porto'
import { buildStreetIndex, loadStreetNetwork } from '../streets'
import { overlayLatLngs, readout } from './overlay'
import { LEVELS, SAMPLE_M, lapDeviation, lapProximity, proximityColor, quantize } from './proximity'
import { bearingFromDrag, handlePixel } from './rotate'
import type { AppState } from './state'
import {
  addRoutePoint,
  applyPlacement,
  clearRoute,
  initialState,
  loadPlacement,
  moveTo,
  rotateTo,
  selectCircuit,
  setScale,
  undoRoutePoint,
} from './state'
import { createSuggester } from './suggest'
import type { Suggester } from './suggest'
import type { SearchInput, Suggestion } from '../match/types'
import type { SuggestView } from '../ui/controls'
import {
  getPlacement,
  makeSavedPlacement,
  placementsEqual,
  removePlacement,
  routesEqual,
  savedRoute,
  savedToPlacement,
  setPlacement,
} from '../placements'
import type { SavedPlacement } from '../placements'
import { loadPlacements, savePlacements } from './storage'
import { routeStats } from './trace'
import type { RouteStats } from './trace'
import { bind, renderControls, updateReadout } from '../ui/controls'

export { PORTO_CENTER, PORTO_ZOOM }

/** Screen distance from the anchor to the rotate handle. */
const HANDLE_PIXEL_RADIUS = 90

/** Traced-route polyline colour. */
const ROUTE_COLOR = '#1565c0'

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

  // The network bbox in Porto-frame metres — the area the Phase 6 search sweeps.
  const sw = project.toLocal([network.bbox[0], network.bbox[1]])
  const ne = project.toLocal([network.bbox[2], network.bbox[3]])
  const searchBBox = {
    min: [Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1])] as Point,
    max: [Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])] as Point,
  }
  const streetLatLngs: L.LatLngExpression[][] = network.ways.map((way) =>
    way.map((p) => toLatLng(project.toLonLat(p))),
  )
  const streetLayer = L.polyline(streetLatLngs, {
    weight: 1,
    opacity: 0.5,
    color: '#8a8a8a',
    interactive: false,
  }).addTo(map)

  // Saved placements: one per circuit, from localStorage. The in-memory store
  // stays authoritative for the session even if a write fails.
  let placements = loadPlacements()
  let previewingSaved = false
  let tracing = false
  let studyView = false

  // Phase 6 suggested placements: an opt-in search, its results, and the row
  // currently hovered (drawn as a dashed preview without touching state).
  let suggester: Suggester = createSuggester()
  let suggest: SuggestView = { phase: 'idle', suggestions: [], selectedIndex: null }
  let previewSuggestion: Suggestion | null = null

  function clearSuggestions(): void {
    suggester.cancel()
    suggest = { phase: 'idle', suggestions: [], selectedIndex: null }
    previewSuggestion = null
  }

  let state: AppState = initialState(circuits, PORTO_CENTER)
  {
    const saved = getPlacement(placements, state.circuitId)
    if (saved) {
      state = loadPlacement(
        state,
        circuits,
        saved.circuitId,
        savedToPlacement(saved),
        savedRoute(saved),
      )
      map.setView(toLatLng(state.placement.anchor))
    }
  }
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

  // Traced route: one polyline, plus a vertex-marker layer shown only in trace mode.
  const routeLine = L.polyline([], {
    weight: 4,
    color: ROUTE_COLOR,
    interactive: false,
  }).addTo(map)
  const vertexLayer = L.layerGroup().addTo(map)

  const savedForCurrent = (): SavedPlacement | undefined =>
    getPlacement(placements, state.circuitId)
  const hasUnsavedChanges = (): boolean => {
    const saved = savedForCurrent()
    if (!saved) return true
    return (
      !placementsEqual(state.placement, savedToPlacement(saved)) ||
      !routesEqual(state.route, savedRoute(saved))
    )
  }

  /** Stats for the current route against the *live* placement's centreline. */
  const currentRouteStats = (): RouteStats | null => {
    if (state.route.length < 2) return null
    const ring = overlayLatLngs(circuitById(state.circuitId), state.placement).map((c) =>
      project.toLocal(c),
    )
    return routeStats(
      state.route.map((c) => project.toLocal(c)),
      ring,
    )
  }
  const circuitLapM = (): number =>
    readout(circuitById(state.circuitId), state.placement.scale).lapM

  function render({ repositionHandle = true }: { repositionHandle?: boolean } = {}): void {
    const circuit = circuitById(state.circuitId)
    const saved = savedForCurrent()
    const previewSaved = previewingSaved && saved !== undefined
    // A hovered suggestion outranks the saved preview; either draws dashed.
    const shown = previewSuggestion
      ? previewSuggestion.placement
      : previewSaved
        ? savedToPlacement(saved!)
        : state.placement
    const preview = previewSaved || previewSuggestion !== null

    const ringLonLat = overlayLatLngs(circuit, shown)
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
    for (let q = 0; q < LEVELS; q++) {
      buckets[q]!.setLatLngs(perBucket[q]!)
      buckets[q]!.setStyle(preview ? { dashArray: '5 6', opacity: 0.55 } : { dashArray: undefined, opacity: 0.9 })
    }

    // The handle is inert and hidden while previewing, tracing, or in study
    // view; the live anchor/rotation still drive it so nothing jumps on exit.
    const inert = preview || tracing || studyView
    handle.setOpacity(inert ? 0 : 1)
    if (inert) handle.dragging?.disable()
    else handle.dragging?.enable()
    if (repositionHandle) {
      const centerPx = map.latLngToContainerPoint(toLatLng(state.placement.anchor))
      const hp = handlePixel(
        [centerPx.x, centerPx.y],
        state.placement.rotationRad,
        HANDLE_PIXEL_RADIUS,
      )
      handle.setLatLng(map.containerPointToLatLng(L.point(hp[0], hp[1])))
    }

    // Traced route.
    routeLine.setLatLngs(state.route.map(toLatLng))
    vertexLayer.clearLayers()
    if (tracing) {
      for (const p of state.route) {
        L.circleMarker(toLatLng(p), {
          radius: 4,
          weight: 2,
          color: ROUTE_COLOR,
          fillColor: '#fff',
          fillOpacity: 1,
          interactive: false,
        }).addTo(vertexLayer)
      }
    }

    const { lapM, straightM } = readout(circuit, shown.scale)
    updateReadout(panelEl, {
      lapM,
      straightM,
      nearFraction,
      routeStats: currentRouteStats(),
      circuitLengthM: circuitLapM(),
    })
  }

  /** Add or remove the circuit / street layers for the current trace + study state. */
  function applyLayerVisibility(): void {
    const showCircuit = !studyView
    for (const b of buckets) {
      if (showCircuit) b.addTo(map)
      else b.remove()
    }
    // The drag target is also off while tracing so map clicks reach the map.
    if (showCircuit && !tracing) dragTarget.addTo(map)
    else dragTarget.remove()
    if (showStreets && !studyView) streetLayer.addTo(map)
    else streetLayer.remove()
    container.classList.toggle('circuit-finder--study', studyView)
  }

  // rAF-throttled progress-bar update while a search runs (no full re-render).
  let suggestFrame: number | null = null
  function scheduleSuggestProgress(): void {
    if (suggestFrame !== null) return
    suggestFrame = requestAnimationFrame(() => {
      suggestFrame = null
      const el = panelEl.querySelector<HTMLProgressElement>('[data-role="suggest-progress"]')
      if (el && suggest.progress) {
        el.value = suggest.progress.done
        el.max = suggest.progress.total
      }
    })
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
    const saved = savedForCurrent() ?? null
    panelEl.innerHTML = renderControls({
      circuits,
      selectedId: state.circuitId,
      scale: state.placement.scale,
      showStreets,
      saved,
      hasUnsavedChanges: hasUnsavedChanges(),
      previewingSaved,
      tracing,
      studyView,
      routePointCount: state.route.length,
      routeStats: currentRouteStats(),
      circuitLengthM: circuitLapM(),
      suggest,
    })
    disposeControls?.()
    disposeControls = bind(panelEl, {
      onSelectCircuit(id) {
        state = selectCircuit(state, circuits, id)
        previewingSaved = false
        clearSuggestions()
        const s = getPlacement(placements, id)
        if (s) {
          state = loadPlacement(state, circuits, s.circuitId, savedToPlacement(s), savedRoute(s))
          map.setView(toLatLng(state.placement.anchor))
        }
        renderPanel()
        render()
      },
      onScaleChange(scale) {
        state = setScale(state, scale)
        previewingSaved = false
        render()
      },
      onToggleStreets(show) {
        showStreets = show
        applyLayerVisibility()
      },
      onSave() {
        const existing = savedForCurrent()
        if (
          existing &&
          hasUnsavedChanges() &&
          !window.confirm(`Replace the saved placement for ${circuitById(state.circuitId).name}?`)
        ) {
          return
        }
        placements = setPlacement(
          placements,
          makeSavedPlacement(state.circuitId, state.placement, state.route, new Date()),
        )
        savePlacements(placements)
        previewingSaved = false
        renderPanel()
      },
      onRevertToSaved() {
        const saved = savedForCurrent()
        if (!saved) return
        state = loadPlacement(
          state,
          circuits,
          saved.circuitId,
          savedToPlacement(saved),
          savedRoute(saved),
        )
        previewingSaved = false
        map.setView(toLatLng(state.placement.anchor))
        renderPanel()
        render()
      },
      onDeleteSaved() {
        if (!savedForCurrent()) return
        if (!window.confirm(`Delete the saved placement for ${circuitById(state.circuitId).name}?`)) {
          return
        }
        placements = removePlacement(placements, state.circuitId)
        savePlacements(placements)
        previewingSaved = false
        renderPanel()
        render()
      },
      onTogglePreviewSaved(show) {
        previewingSaved = show && savedForCurrent() !== undefined
        if (previewingSaved) clearSuggestions()
        renderPanel()
        render()
      },
      onToggleTrace() {
        tracing = !tracing
        if (tracing) previewingSaved = false
        clearSuggestions()
        applyLayerVisibility()
        renderPanel()
        render()
      },
      onUndoRoutePoint() {
        state = undoRoutePoint(state)
        renderPanel()
        render()
      },
      onClearRoute() {
        state = clearRoute(state)
        renderPanel()
        render()
      },
      onToggleStudyView() {
        studyView = !studyView
        if (studyView) tracing = false
        clearSuggestions()
        applyLayerVisibility()
        renderPanel()
        render()
      },
      onSuggest() {
        if (suggest.phase === 'running') return
        const circuit = circuitById(state.circuitId)
        const input: SearchInput = {
          circuitSamplesM: resample(circuit.metricCentreline, SAMPLE_M),
          scale: state.placement.scale,
          index: streetIndex,
          bbox: searchBBox,
        }
        suggester.cancel()
        suggester = createSuggester()
        const active = suggester
        previewingSaved = false
        previewSuggestion = null
        suggest = {
          phase: 'running',
          progress: { done: 0, total: 1 },
          suggestions: [],
          selectedIndex: null,
        }
        renderPanel()
        render()
        void active
          .run(input, (p) => {
            if (suggester !== active) return
            suggest = { ...suggest, progress: p }
            scheduleSuggestProgress()
          })
          .then((results) => {
            if (suggester !== active) return
            // Re-label each suggestion with the *same* coverage/deviation the
            // live map will show once it is applied, so the numbers agree.
            const circuit = circuitById(state.circuitId)
            const suggestions = results.map((s) => {
              const ring = overlayLatLngs(circuit, s.placement).map((cd) => project.toLocal(cd))
              const dev = lapDeviation(ring, streetIndex)
              return {
                ...s,
                coverageFraction: lapProximity(ring, streetIndex).nearFraction,
                meanDeviationM: dev.meanM,
                maxDeviationM: dev.maxM,
              }
            })
            suggestions.sort((a, b) => b.coverageFraction - a.coverageFraction)
            suggest = { phase: 'results', suggestions, selectedIndex: null }
            renderPanel()
            render()
          })
      },
      onCancelSuggest() {
        clearSuggestions()
        renderPanel()
        render()
      },
      onUseSuggestion(index) {
        const chosen = suggest.suggestions[index]
        if (!chosen) return
        if (
          state.route.length > 0 &&
          !window.confirm(
            `Use this suggestion for ${circuitById(state.circuitId).name}? ` +
              'The traced route will be cleared.',
          )
        ) {
          return
        }
        state = applyPlacement(state, chosen.placement)
        clearSuggestions()
        previewingSaved = false
        map.setView(toLatLng(state.placement.anchor))
        renderPanel()
        render()
      },
      onPreviewSuggestion(index) {
        if (suggest.phase !== 'results') return
        previewSuggestion = index === null ? null : suggest.suggestions[index] ?? null
        suggest = { ...suggest, selectedIndex: index }
        render()
      },
      onClearSuggestions() {
        clearSuggestions()
        renderPanel()
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
    if (previewingSaved || tracing || studyView) return // overlay is locked
    moveFrom = { pointer: e.latlng, anchor: state.placement.anchor }
    map.dragging.disable()
    L.DomEvent.stop(e)
  }

  // --- Trace: click the map to append a route vertex ------------------------
  const onMapClick = (e: L.LeafletMouseEvent): void => {
    if (!tracing) return
    state = addRoutePoint(state, [e.latlng.lng, e.latlng.lat])
    render()
    renderPanel()
  }
  map.on('click', onMapClick)
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
    renderPanel() // refresh the saved-placement indicator now the move has settled
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
    renderPanel()
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
      suggester.cancel()
      if (frame !== null) cancelAnimationFrame(frame)
      if (suggestFrame !== null) cancelAnimationFrame(suggestFrame)
      frame = null
      suggestFrame = null
      disposeControls?.()
      dragTarget.off()
      handle.off()
      routeLine.remove()
      vertexLayer.remove()
      map.off()
      map.remove()
      container.replaceChildren()
      container.classList.remove('circuit-finder')
    },
  }
}
