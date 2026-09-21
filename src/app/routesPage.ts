// Phase 23: the routes page — a lookup, not a tool. Pick a circuit, see one of
// its stored (Phase 22) routes on a real OSM basemap with the circuit's outline
// dashed over it, read plainly how well it matches (and how it misses, when it
// does), and download it as GPX. Nothing here is computed beyond placing the
// outline; the route files are injected, so tests need no real data and the
// page never knows how they are bundled. See docs/specs/phase-23-routes-page.md.
import L from 'leaflet'
import { escapeHtml } from '../circuits'
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import { PORTO_CENTER, PORTO_ZOOM } from '../porto'
import type { RouteEntry, RouteFile } from '../routes'
import { barMisses } from './barMisses'
import { addBasemap } from './basemap'
import { downloadFile } from './download'
import { routeGpx, routeGpxFilename } from './gpx'
import { formatDistance, overlayLatLngs } from './overlay'
import { formatHash, parseHash } from './routesHash'
import type { RouteRef } from './routesHash'

const ROUTE_COLOR = '#1565c0'
const OUTLINE_COLOR = '#c62828'
const START_COLOR = '#2e7d32'

export type RoutesPageDeps = {
  /** Circuit ids that have a stored route file — known up front, so the list
   *  can show (and disable) the ones without one without loading anything. */
  availableIds: ReadonlySet<string>
  /** The stored routes for one circuit. Called lazily, on selection. */
  loadRoutes(circuitId: string): Promise<RouteFile>
}

export type RoutesPage = {
  /** Resolves once the initial selection (from the URL hash, or the first
   *  available route) has been rendered. */
  ready: Promise<void>
  destroy(): void
}

const toLatLng = ([lon, lat]: LonLat): L.LatLng => L.latLng(lat, lon)

function closed<T>(ring: readonly T[]): T[] {
  return ring.length > 0 ? [...ring, ring[0]!] : []
}

/** "2 %", or "0.1 %" when a whole-number percentage would hide it. */
function formatPercent(fraction: number): string {
  const pct = fraction * 100
  return pct >= 1 || pct === 0 ? `${Math.round(pct)} %` : `${pct.toFixed(1)} %`
}

function formatCoord(value: number): string {
  return value.toFixed(5)
}

function osmLink(lon: number, lat: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<'className' | 'textContent' | 'href' | 'type', string>> = {},
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

export function createRoutesPage(
  container: HTMLElement,
  circuits: readonly MetricCircuit[],
  deps: RoutesPageDeps,
): RoutesPage {
  if (circuits.length === 0) throw new Error('createRoutesPage: no circuits')

  // --- Skeleton ------------------------------------------------------------
  container.classList.add('circuit-finder', 'routes-page')
  const mapEl = el('div', { className: 'map' })
  const panelEl = el('aside', { className: 'panel routes-panel' })
  container.append(mapEl, panelEl)

  const backLink = el('a', { className: 'page-link-inline', href: './', textContent: '← Circuit finder tool' })
  const heading = el('h1', { className: 'routes-heading', textContent: 'Generated routes' })

  const selectLabel = el('label', { className: 'control' })
  selectLabel.append('Circuit')
  const circuitSelect = el('select', {}, { 'data-role': 'circuit' })
  for (const c of circuits) {
    const has = deps.availableIds.has(c.id)
    const option = el('option', { textContent: has ? c.name : `${c.name} — no route generated yet` })
    option.value = c.id
    option.disabled = !has
    circuitSelect.append(option)
  }
  selectLabel.append(circuitSelect)

  const picker = el('div', { className: 'route-picker' }, { 'data-role': 'route-picker' })
  const details = el('div', { className: 'route-details' }, { 'data-role': 'details' })

  const outlineLabel = el('label', { className: 'check' })
  const outlineBox = el('input', { type: 'checkbox' }, { 'data-role': 'outline' })
  outlineBox.checked = true
  outlineLabel.append(outlineBox, ' Show the circuit outline (dashed)')

  const downloadBtn = el('button', { type: 'button', textContent: 'Download GPX' }, { 'data-role': 'download-gpx' })
  downloadBtn.disabled = true

  panelEl.append(backLink, heading, selectLabel, picker, details, outlineLabel, downloadBtn)

  // --- Map -----------------------------------------------------------------
  const map = L.map(mapEl, { zoomControl: true }).setView(toLatLng(PORTO_CENTER), PORTO_ZOOM)
  addBasemap(map)
  const layers = L.layerGroup().addTo(map)
  let outlineLayer: L.Polyline | null = null
  let attribution = ''

  function setAttribution(html: string): void {
    if (attribution) map.attributionControl.removeAttribution(attribution)
    attribution = html
    if (html) map.attributionControl.addAttribution(html)
  }

  // --- State ---------------------------------------------------------------
  let showOutline = true
  let current: { circuit: MetricCircuit; file: RouteFile; route: RouteEntry } | null = null
  let token = 0
  let destroyed = false

  const circuitById = (id: string): MetricCircuit | undefined => circuits.find((c) => c.id === id)

  function firstAvailable(): MetricCircuit | undefined {
    return circuits.find((c) => deps.availableIds.has(c.id))
  }

  function renderPicker(file: RouteFile, selectedRank: number): void {
    picker.replaceChildren()
    for (const route of file.routes) {
      const misses = barMisses(route.metrics, file.generator.bar)
      const btn = el(
        'button',
        {
          type: 'button',
          className: `route-btn ${misses.length === 0 ? 'route-btn--ok' : 'route-btn--miss'}`,
          textContent: `Route ${route.rank} · ${misses.length === 0 ? 'meets the bar' : 'misses the bar'}`,
        },
        { 'data-role': 'route', 'data-rank': String(route.rank), 'aria-pressed': String(route.rank === selectedRank) },
      )
      btn.addEventListener('click', () => {
        if (current) void select({ circuitId: current.circuit.id, rank: route.rank })
      })
      picker.append(btn)
    }
  }

  function renderDetails(circuit: MetricCircuit, file: RouteFile, route: RouteEntry): void {
    const m = route.metrics
    const misses = barMisses(m, file.generator.bar)
    details.replaceChildren()

    const badge = el('div', {
      className: `badge ${misses.length === 0 ? 'badge--ok' : 'badge--miss'}`,
      textContent: misses.length === 0 ? 'Meets the bar' : 'Misses the bar',
    }, { 'data-role': 'badge' })
    details.append(badge)
    if (misses.length > 0) {
      const missList = el('ul', { className: 'misses' }, { 'data-role': 'misses' })
      for (const miss of misses) missList.append(el('li', { textContent: miss }))
      details.append(missList)
    }

    const list = el('ul', { className: 'metrics' }, { 'data-role': 'metrics' })
    for (const line of [
      `Length ${formatDistance(m.lengthM)} (${m.lengthRatio.toFixed(2)}× the circuit)`,
      `Strays from the circuit by ${Math.round(m.meanDeviationM)} m on average, ${Math.round(m.maxDeviationM)} m at most`,
      `Retraces ${formatPercent(m.retracedFraction)} of its length`,
    ]) {
      list.append(el('li', { textContent: line }))
    }
    list.append(el('li', { className: 'metrics__minor', textContent: `Shape distance ${Math.round(m.frechetM)} m` }))
    details.append(list)

    const [startLon, startLat] = route.points[0]!
    if (route.area) details.append(el('p', { className: 'area', textContent: route.area }, { 'data-role': 'area' }))
    const where = el('p', { className: 'where' })
    where.append(`Starts at ${formatCoord(startLat)}, ${formatCoord(startLon)} · `)
    where.append(
      el('a', { href: osmLink(startLon, startLat), textContent: 'Open in OpenStreetMap' }, { 'data-role': 'osm-link', target: '_blank', rel: 'noopener' }),
    )
    details.append(where)

    const notes = [`Generated ${file.generatedAt}`]
    if (file.scale !== 1) notes.push(`circuit scaled ×${file.scale}`)
    details.append(el('p', { className: 'note', textContent: `${circuit.name} · ${notes.join(' · ')}` }))
  }

  function drawMap(circuit: MetricCircuit, file: RouteFile, route: RouteEntry): void {
    layers.clearLayers()
    outlineLayer = null

    const outline = overlayLatLngs(circuit, {
      anchor: route.pose.anchor,
      rotationRad: route.pose.rotationRad,
      scale: file.scale,
    })
    outlineLayer = L.polyline(closed(outline).map(toLatLng), {
      color: OUTLINE_COLOR,
      weight: 3,
      opacity: 0.8,
      dashArray: '8 8',
    })
    if (showOutline) outlineLayer.addTo(layers)

    const routeLine = L.polyline(closed(route.points).map(toLatLng), { color: ROUTE_COLOR, weight: 5, opacity: 0.9 }).addTo(layers)
    L.circleMarker(toLatLng(route.points[0]!), {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: START_COLOR,
      fillOpacity: 1,
    })
      .bindTooltip('Start')
      .addTo(layers)

    // Keep the route clear of the panel: it floats over the right edge on a
    // wide screen and over the bottom on a narrow one (see style.css).
    const narrow = window.matchMedia?.('(max-width: 600px)').matches ?? false
    map.fitBounds(routeLine.getBounds(), {
      paddingTopLeft: [30, 30],
      paddingBottomRight: narrow ? [30, panelEl.offsetHeight + 30] : [panelEl.offsetWidth + 30, 30],
    })
    const attr = circuit.attribution
    setAttribution(
      `Circuit & street geometry: <a href="${escapeHtml(attr.url)}">${escapeHtml(attr.source)}</a> (${escapeHtml(attr.license)})`,
    )
  }

  function showMessage(text: string): void {
    layers.clearLayers()
    outlineLayer = null
    current = null
    picker.replaceChildren()
    details.replaceChildren(el('p', { className: 'message', textContent: text }, { 'data-role': 'message' }))
    downloadBtn.disabled = true
  }

  /** Select a route. An unknown circuit (or one with no file) falls back to the
   *  first available circuit; an unknown rank falls back to that circuit's
   *  first route — a stale or hand-edited URL never breaks the page. */
  async function select(ref: RouteRef | null, opts: { updateHash?: boolean } = {}): Promise<void> {
    const mine = ++token
    const wanted = ref && deps.availableIds.has(ref.circuitId) ? circuitById(ref.circuitId) : undefined
    const circuit = wanted ?? firstAvailable()
    if (!circuit) {
      showMessage('No routes have been generated yet.')
      return
    }

    let file: RouteFile
    try {
      file = await deps.loadRoutes(circuit.id)
    } catch {
      if (mine === token && !destroyed) showMessage(`Could not load the routes for ${circuit.name}.`)
      return
    }
    if (mine !== token || destroyed) return // a newer selection superseded this one

    const route = (wanted && ref ? file.routes.find((r) => r.rank === ref.rank) : undefined) ?? file.routes[0]!
    current = { circuit, file, route }
    circuitSelect.value = circuit.id
    renderPicker(file, route.rank)
    renderDetails(circuit, file, route)
    drawMap(circuit, file, route)
    downloadBtn.disabled = false

    if (opts.updateHash !== false) {
      try {
        history.replaceState(null, '', formatHash({ circuitId: circuit.id, rank: route.rank }))
      } catch {
        // No history API (sandboxed frame, etc.): the page works, just without a bookmarkable URL.
      }
    }
  }

  // --- Wiring --------------------------------------------------------------
  circuitSelect.addEventListener('change', () => void select({ circuitId: circuitSelect.value, rank: 1 }))

  outlineBox.addEventListener('change', () => {
    showOutline = outlineBox.checked
    if (!outlineLayer) return
    if (showOutline) outlineLayer.addTo(layers)
    else layers.removeLayer(outlineLayer)
  })

  downloadBtn.addEventListener('click', () => {
    if (!current) return
    const { circuit, route } = current
    downloadFile(routeGpxFilename(circuit.id, route.rank), routeGpx(circuit.name, route.rank, route.points), 'application/gpx+xml')
  })

  const onHashChange = (): void => {
    const ref = parseHash(window.location.hash)
    if (!ref) return
    if (current && current.circuit.id === ref.circuitId && current.route.rank === ref.rank) return
    void select(ref, { updateHash: false })
  }
  window.addEventListener('hashchange', onHashChange)

  const ready = select(parseHash(window.location.hash))

  return {
    ready,
    destroy() {
      if (destroyed) return
      destroyed = true
      window.removeEventListener('hashchange', onHashChange)
      map.remove()
      container.replaceChildren()
      container.classList.remove('circuit-finder', 'routes-page')
    },
  }
}
