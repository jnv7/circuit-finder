// Phase 23: the routes page — a lookup, not a tool. Pick a circuit, see one of
// its stored (Phase 22) routes on a real OSM basemap with the circuit's outline
// dashed over it, read plainly how well it matches (and how it misses, when it
// does), and download it as GPX. Phase 26 adds a region checkbox row: every
// region is searched independently (`src/regions.ts`), and the picker always
// shows the best 3 routes *among the checked regions*, re-ranked live as
// checkboxes change, with a dashed, non-intrusive rectangle per checked
// region on the map. Nothing here is computed beyond placing the outline and
// picking/ranking; the route files are injected, so tests need no real data
// and the page never knows how they are bundled. See
// docs/specs/phase-23-routes-page.md and docs/specs/phase-26-regional-search.md.
import L from 'leaflet'
import { escapeHtml } from '../circuits'
import type { MetricCircuit } from '../circuits'
import type { LonLat } from '../geo'
import { PORTO_CENTER, PORTO_ZOOM } from '../porto'
import { REGIONS, regionLabel } from '../regions'
import type { RegionId } from '../regions'
import type { RouteEntry, RouteFile } from '../routes'
import { barMisses } from './barMisses'
import { addBasemap } from './basemap'
import { downloadFile } from './download'
import { routeGpx, routeGpxFilename } from './gpx'
import { formatDistance, overlayLatLngs } from './overlay'
import { pickerSummaryLine, pickTopRoutes } from './routeSummary'
import { formatHash, parseCircuitHash, parseHash } from './routesHash'

const ROUTE_COLOR = '#1565c0'
const OUTLINE_COLOR = '#c62828'
const START_COLOR = '#2e7d32'
const REGION_OUTLINE_COLOR = '#757575'

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

function regionRectBounds(ids: ReadonlySet<RegionId>): L.LatLngBounds | null {
  let bounds: L.LatLngBounds | null = null
  for (const region of REGIONS) {
    if (!ids.has(region.id)) continue
    const b = L.latLngBounds([region.bbox[1], region.bbox[0]], [region.bbox[3], region.bbox[2]])
    bounds = bounds ? bounds.extend(b) : b
  }
  return bounds
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

  const backLink = el('a', { className: 'page-link-inline', href: './', textContent: '← All circuits' })
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

  const regionsRow = el('div', { className: 'region-row' }, { 'data-role': 'regions' })
  const selectedRegions = new Set<RegionId>(REGIONS.map((r) => r.id))
  for (const region of REGIONS) {
    const label = el('label', { className: 'check' })
    const box = el('input', { type: 'checkbox' }, { 'data-role': 'region-toggle', 'data-region': region.id })
    box.checked = true
    label.append(box, ` ${region.label}`)
    regionsRow.append(label)
    box.addEventListener('change', () => {
      if (box.checked) selectedRegions.add(region.id)
      else selectedRegions.delete(region.id)
      onRegionsChanged()
    })
  }

  const picker = el('div', { className: 'route-picker' }, { 'data-role': 'route-picker' })
  const details = el('div', { className: 'route-details' }, { 'data-role': 'details' })

  const outlineLabel = el('label', { className: 'check' })
  const outlineBox = el('input', { type: 'checkbox' }, { 'data-role': 'outline' })
  outlineBox.checked = true
  outlineLabel.append(outlineBox, ' Show the circuit outline (dashed)')

  const downloadBtn = el('button', { type: 'button', textContent: 'Download GPX' }, { 'data-role': 'download-gpx' })
  downloadBtn.disabled = true

  panelEl.append(backLink, heading, selectLabel, regionsRow, picker, details, outlineLabel, downloadBtn)

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
  // `route` is null when a circuit/file is loaded but no route matches the
  // current region checkboxes — `current` itself stays non-null so toggling
  // a region back on can still find its way back (Phase 26).
  let current: { circuit: MetricCircuit; file: RouteFile; route: RouteEntry | null } | null = null
  let token = 0
  let destroyed = false

  const circuitById = (id: string): MetricCircuit | undefined => circuits.find((c) => c.id === id)

  function firstAvailable(): MetricCircuit | undefined {
    return circuits.find((c) => deps.availableIds.has(c.id))
  }

  function renderDetails(circuit: MetricCircuit, file: RouteFile, route: RouteEntry): void {
    const m = route.metrics
    const misses = barMisses(m, file.generator.bar)
    details.replaceChildren()

    if (misses.length > 0) {
      const missList = el('ul', { className: 'misses' }, { 'data-role': 'misses' })
      for (const miss of misses) missList.append(el('li', { textContent: miss }))
      details.append(missList)
    }

    const list = el('ul', { className: 'metrics' }, { 'data-role': 'metrics' })
    for (const line of [
      `Length ${formatDistance(m.lengthM)} (${m.lengthRatio.toFixed(2)}× the circuit)`,
      `Retraces ${formatPercent(m.retracedFraction)} of its length`,
    ]) {
      list.append(el('li', { textContent: line }))
    }
    list.append(el('li', { className: 'metrics__minor', textContent: `Shape distance ${Math.round(m.frechetM)} m` }))
    details.append(list)

    const [startLon, startLat] = route.points[0]!
    details.append(el('p', { className: 'region', textContent: regionLabel(route.region) }, { 'data-role': 'region' }))
    const where = el('p', { className: 'where' })
    where.append(`Starts at ${formatCoord(startLat)}, ${formatCoord(startLon)} · `)
    where.append(
      el('a', { href: osmLink(startLon, startLat), textContent: 'Open in OpenStreetMap' }, { 'data-role': 'osm-link', target: '_blank', rel: 'noopener' }),
    )
    details.append(where)

    const notes = [`Generated ${file.generatedAt}`]
    if (file.scale !== 1) notes.push(`circuit scaled ×${file.scale}`)
    details.append(
      el('p', {
        className: 'note',
        textContent: `${circuit.name} (${formatDistance(circuit.officialLengthM)}) · ${notes.join(' · ')}`,
      }),
    )
  }

  function drawMap(circuit: MetricCircuit, file: RouteFile, route: RouteEntry | null): void {
    layers.clearLayers()
    outlineLayer = null

    for (const region of REGIONS) {
      if (!selectedRegions.has(region.id)) continue
      L.rectangle(
        [
          [region.bbox[1], region.bbox[0]],
          [region.bbox[3], region.bbox[2]],
        ],
        { color: REGION_OUTLINE_COLOR, weight: 1, opacity: 0.6, fill: false, dashArray: '4 6', interactive: false },
      ).addTo(layers)
    }

    if (!route) {
      const bounds = regionRectBounds(selectedRegions)
      if (bounds) map.fitBounds(bounds, { padding: [30, 30] })
      setAttribution('')
      return
    }

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

  function renderPickedRoutes(file: RouteFile, picked: readonly RouteEntry[], selected: RouteEntry | undefined): void {
    picker.replaceChildren()
    picked.forEach((route, i) => {
      const misses = barMisses(route.metrics, file.generator.bar)
      const best = i === 0
      const btn = el(
        'button',
        { type: 'button', className: `route-btn ${misses.length === 0 ? 'route-btn--ok' : 'route-btn--miss'}${best ? ' route-btn--best' : ''}` },
        {
          'data-role': 'route',
          'data-rank': String(route.rank),
          'data-region': route.region,
          'aria-pressed': String(selected === route),
        },
      )
      if (best) btn.append(el('span', { className: 'badge badge--best', textContent: 'Best' }))
      btn.append(
        el('span', {
          className: 'route-btn__title',
          textContent: `${regionLabel(route.region)}, route ${route.rank} · ${misses.length === 0 ? 'meets the bar' : 'misses the bar'}`,
        }),
        el('span', { className: 'route-btn__metrics', textContent: pickerSummaryLine(route.metrics) }),
      )
      btn.addEventListener('click', () => {
        if (current) void select({ circuitId: current.circuit.id, region: route.region, rank: route.rank })
      })
      picker.append(btn)
    })
  }

  function pickedFor(file: RouteFile): RouteEntry[] {
    return pickTopRoutes(file.routes, selectedRegions, file.generator.bar)
  }

  function onRegionsChanged(): void {
    if (!current) return
    const { circuit, file, route } = current
    const picked = pickedFor(file)
    const stillThere = route ? picked.find((r) => r.region === route.region && r.rank === route.rank) : undefined
    const next = stillThere ?? picked[0] ?? null
    current = { circuit, file, route: next }

    renderPickedRoutes(file, picked, next ?? undefined)
    if (next) {
      renderDetails(circuit, file, next)
      downloadBtn.disabled = false
    } else {
      details.replaceChildren(
        el('p', { className: 'message', textContent: 'No routes match the selected regions.' }, { 'data-role': 'message' }),
      )
      downloadBtn.disabled = true
    }
    drawMap(circuit, file, next ?? null)

    if (next) {
      try {
        history.replaceState(null, '', formatHash({ circuitId: circuit.id, region: next.region, rank: next.rank }))
      } catch {
        // No history API (sandboxed frame, etc.): the page works, just without a bookmarkable URL.
      }
    }
  }

  /** A specific route (`region` + `rank`), or just a circuit — "pick the best
   *  route among the checked regions" (used when switching circuit, or when
   *  a referenced region/rank doesn't exist or got filtered out). */
  type Selection = { circuitId: string; region?: string; rank?: number }

  /** The full `#circuit/region/rank` form, or just `#circuit` (the home page's
   *  circuit cards link this way, not knowing which route is best). */
  function parseSelection(hash: string): Selection | null {
    return parseHash(hash) ?? parseCircuitHash(hash)
  }

  /** Select a route. An unknown circuit (or one with no file) falls back to the
   *  first available circuit; an unknown region/rank, or one filtered out by
   *  the current region checkboxes, falls back to the best route among the
   *  checked regions — a stale or hand-edited URL never breaks the page. */
  async function select(sel: Selection | null, opts: { updateHash?: boolean } = {}): Promise<void> {
    const mine = ++token
    const wanted = sel && deps.availableIds.has(sel.circuitId) ? circuitById(sel.circuitId) : undefined
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

    const picked = pickedFor(file)
    const route =
      (wanted && sel?.region !== undefined && sel.rank !== undefined
        ? picked.find((r) => r.region === sel.region && r.rank === sel.rank)
        : undefined) ?? picked[0] ?? null
    current = { circuit, file, route }
    circuitSelect.value = circuit.id

    renderPickedRoutes(file, picked, route ?? undefined)
    if (route) {
      renderDetails(circuit, file, route)
      downloadBtn.disabled = false
    } else {
      details.replaceChildren(
        el('p', { className: 'message', textContent: 'No routes match the selected regions.' }, { 'data-role': 'message' }),
      )
      downloadBtn.disabled = true
    }
    drawMap(circuit, file, route ?? null)

    if (opts.updateHash !== false && route) {
      try {
        history.replaceState(null, '', formatHash({ circuitId: circuit.id, region: route.region, rank: route.rank }))
      } catch {
        // No history API (sandboxed frame, etc.): the page works, just without a bookmarkable URL.
      }
    }
  }

  // --- Wiring --------------------------------------------------------------
  circuitSelect.addEventListener('change', () => void select({ circuitId: circuitSelect.value }))

  outlineBox.addEventListener('change', () => {
    showOutline = outlineBox.checked
    if (!outlineLayer) return
    if (showOutline) outlineLayer.addTo(layers)
    else layers.removeLayer(outlineLayer)
  })

  downloadBtn.addEventListener('click', () => {
    if (!current?.route) return
    const { circuit, route } = current
    const label = regionLabel(route.region)
    downloadFile(
      routeGpxFilename(circuit.id, route.region, route.rank),
      routeGpx(circuit.name, label, route.rank, route.points),
      'application/gpx+xml',
    )
  })

  const onHashChange = (): void => {
    const ref = parseSelection(window.location.hash)
    if (!ref) return
    if (current && current.circuit.id === ref.circuitId && current.route?.region === ref.region && current.route?.rank === ref.rank) return
    void select(ref, { updateHash: false })
  }
  window.addEventListener('hashchange', onHashChange)

  const ready = select(parseSelection(window.location.hash))

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
