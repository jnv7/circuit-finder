// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { pathLength } from '../geometry/path'
import { portoProjection } from '../porto'
import { loadRouteFile } from '../routes'
import type { RouteFile } from '../routes'
import { routeDeviation } from './trace'
import { overlayLatLngs } from './overlay'
import { createRoutesPage } from './routesPage'
import type { RoutesPage, RoutesPageDeps } from './routesPage'

// Leaflet reads element sizes off the container; jsdom reports 0 for all of
// them. Same nominal size as map.test.ts.
// The floating panel gets a realistic size, since the page pads the map's fit
// around it.
beforeAll(() => {
  const size = (el: HTMLElement, panelSize: number) => (el.classList.contains('panel') ? panelSize : 800)
  for (const prop of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const) {
    const panelSize = prop.endsWith('Width') ? 320 : 400
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return size(this, panelSize)
      },
    })
  }
})

const circuits = loadMetricCircuits()
const flush = () => new Promise((r) => setTimeout(r, 0))

const ROUTE_STROKE = '#1565c0'
const OUTLINE_STROKE = '#c62828'
const START_FILL = '#2e7d32'

const BAR = { meanM: 30, maxM: 100, ratioLo: 0.9, ratioHi: 1.2, retrace: 0.05 }
const GOOD = {
  lengthM: 4900,
  lengthRatio: 1.12,
  meanDeviationM: 21,
  maxDeviationM: 68,
  frechetM: 82,
  retracedFraction: 0.018,
}

/** A 24-point ring near Porto — geometry is irrelevant to the page, only that
 *  it is a valid closed loop somewhere on the map. */
function ring(lon: number, lat: number): [number, number][] {
  return Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI
    return [lon + 0.01 * Math.cos(a), lat + 0.006 * Math.sin(a)]
  })
}

function fakeFile(circuitId: string, metrics: Partial<typeof GOOD>[], extra: Partial<RouteFile> = {}): RouteFile {
  return {
    schemaVersion: 1,
    circuitId,
    generatedAt: '2026-09-20',
    scale: 1,
    generator: { poses: 120, escalationTier: 0, bar: BAR },
    streets: { source: 'OpenStreetMap contributors', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org', retrieved: '2026-09-09' },
    routes: metrics.map((m, i) => ({
      rank: i + 1,
      passesBar: true,
      pose: { anchor: [-8.62 - i * 0.01, 41.15], rotationRad: 0.3 * i },
      points: ring(-8.62 - i * 0.01, 41.15),
      metrics: { ...GOOD, ...m },
    })),
    ...extra,
  }
}

const FILES: Record<string, RouteFile> = {
  hungaroring: fakeFile('hungaroring', [{}, { lengthRatio: 1.13 }, { meanDeviationM: 34.8, maxDeviationM: 165.7 }]),
  silverstone: fakeFile('silverstone', [{ lengthM: 6000 }, { lengthM: 6100, lengthRatio: 1.15 }]),
}

const deps = (overrides: Partial<RoutesPageDeps> = {}): RoutesPageDeps => ({
  availableIds: new Set(Object.keys(FILES)),
  loadRoutes: async (id) => FILES[id]!,
  ...overrides,
})

let pages: RoutesPage[] = []
const mount = async (d: RoutesPageDeps = deps()) => {
  const container = document.createElement('div')
  document.body.append(container)
  const page = createRoutesPage(container, circuits, d)
  pages.push(page)
  await page.ready
  return container
}

beforeEach(() => {
  history.replaceState(null, '', window.location.pathname)
})
afterEach(() => {
  for (const p of pages) p.destroy()
  pages = []
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const panel = (c: HTMLElement) => c.querySelector('.panel') as HTMLElement
const role = <T extends HTMLElement = HTMLElement>(c: HTMLElement, r: string) =>
  panel(c).querySelector<T>(`[data-role="${r}"]`)!
const paths = (c: HTMLElement) => [...c.querySelectorAll('svg path')]
const byStroke = (c: HTMLElement, stroke: string) => paths(c).filter((p) => p.getAttribute('stroke') === stroke)
const missLines = (c: HTMLElement) => [...panel(c).querySelectorAll('[data-role="misses"] li')].map((li) => li.textContent)
const selectedRank = (c: HTMLElement) =>
  panel(c).querySelector('[data-role="route"][aria-pressed="true"]')?.getAttribute('data-rank')

describe('routes page', () => {
  it('lists every circuit and disables those without a route file', async () => {
    const c = await mount()
    const options = [...role<HTMLSelectElement>(c, 'circuit').options]
    expect(options).toHaveLength(circuits.length)
    for (const o of options) {
      const has = o.value in FILES
      expect(o.disabled).toBe(!has)
      if (!has) expect(o.textContent).toContain('no route generated yet')
    }
    expect(options.find((o) => o.value === 'catalunya')!.disabled).toBe(true)
  })

  it('opens on the first available route, with route buttons, badge and plain-language metrics', async () => {
    const c = await mount()
    expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('hungaroring')
    expect(panel(c).querySelectorAll('[data-role="route"]')).toHaveLength(3)
    expect(selectedRank(c)).toBe('1')
    expect(role(c, 'badge').textContent).toBe('Meets the bar')
    expect(panel(c).querySelector('[data-role="misses"]')).toBeNull()
    const text = role(c, 'metrics').textContent!
    expect(text).toContain('Length 4.90 km (1.12× the circuit)')
    expect(text).toContain('Strays from the circuit by 21 m on average, 68 m at most')
    expect(text).toContain('Retraces 2 % of its length')
    expect(text).toContain('Shape distance 82 m')
  })

  it('draws the route, the dashed circuit outline and a start marker on the map', async () => {
    const c = await mount()
    expect(c.querySelector('.leaflet-tile-pane')).not.toBeNull()
    expect(byStroke(c, ROUTE_STROKE)).toHaveLength(1)
    const outline = byStroke(c, OUTLINE_STROKE)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(paths(c).filter((p) => p.getAttribute('fill') === START_FILL)).toHaveLength(1)
  })

  it('places the outline from the circuit and the route’s own pose and scale', async () => {
    const scaled = fakeFile('hungaroring', [{}], { scale: 2 })
    const c = await mount(deps({ loadRoutes: async () => scaled, availableIds: new Set(['hungaroring']) }))
    const d = byStroke(c, OUTLINE_STROKE)[0]!.getAttribute('d')!
    // Same pose, scale 1: a different (smaller) outline path.
    const c2 = await mount(deps({ loadRoutes: async () => fakeFile('hungaroring', [{}]), availableIds: new Set(['hungaroring']) }))
    expect(byStroke(c2, OUTLINE_STROKE)[0]!.getAttribute('d')).not.toBe(d)
    expect(role(c, 'details').textContent).toContain('circuit scaled ×2')
  })

  it('toggles the outline with its checkbox, and keeps that choice across routes', async () => {
    const c = await mount()
    const box = role<HTMLInputElement>(c, 'outline')
    expect(box.checked).toBe(true)
    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(byStroke(c, OUTLINE_STROKE)).toHaveLength(0)
    expect(byStroke(c, ROUTE_STROKE)).toHaveLength(1)

    panel(c).querySelector<HTMLElement>('[data-role="route"][data-rank="2"]')!.click()
    await flush()
    expect(byStroke(c, OUTLINE_STROKE)).toHaveLength(0)

    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(byStroke(c, OUTLINE_STROKE)).toHaveLength(1)
  })

  it('shows, honestly and in words, how a route that misses the bar misses it', async () => {
    const c = await mount()
    panel(c).querySelector<HTMLElement>('[data-role="route"][data-rank="3"]')!.click()
    await flush()
    expect(selectedRank(c)).toBe('3')
    expect(role(c, 'badge').textContent).toBe('Misses the bar')
    expect(missLines(c)).toEqual(['mean 35 m, limit 30 m', 'longest deviation 166 m, limit 100 m'])
    // Still drawn — nothing is hidden for failing.
    expect(byStroke(c, ROUTE_STROKE)).toHaveLength(1)
    expect(panel(c).querySelector('[data-role="route"][data-rank="3"]')!.textContent).toContain('misses the bar')
  })

  it('judges each route by the bar stored in its own file, not today’s constant', async () => {
    const strict = fakeFile('hungaroring', [{ meanDeviationM: 21 }])
    strict.generator.bar = { ...BAR, meanM: 10 }
    const c = await mount(deps({ loadRoutes: async () => strict }))
    expect(missLines(c)).toEqual(['mean 21 m, limit 10 m'])
  })

  it('shows the route’s area text when it has one, plus start coordinates and an OpenStreetMap link', async () => {
    const file = fakeFile('hungaroring', [{}])
    file.routes[0]!.area = 'Ribeira and Baixa, north bank of the Douro'
    const c = await mount(deps({ loadRoutes: async () => file }))
    expect(role(c, 'area').textContent).toBe('Ribeira and Baixa, north bank of the Douro')
    const [lon, lat] = file.routes[0]!.points[0]!
    expect(role(c, 'details').textContent).toContain(`Starts at ${lat.toFixed(5)}, ${lon.toFixed(5)}`)
    expect(role<HTMLAnchorElement>(c, 'osm-link').href).toBe(
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,
    )
  })

  it('has no area line when the route has none', async () => {
    const c = await mount()
    expect(panel(c).querySelector('[data-role="area"]')).toBeNull()
  })

  it('switching circuit loads that circuit’s first route and updates the URL hash', async () => {
    const c = await mount()
    const select = role<HTMLSelectElement>(c, 'circuit')
    select.value = 'silverstone'
    select.dispatchEvent(new Event('change'))
    await flush()
    expect(panel(c).querySelectorAll('[data-role="route"]')).toHaveLength(2)
    expect(selectedRank(c)).toBe('1')
    expect(window.location.hash).toBe('#silverstone/1')
    panel(c).querySelector<HTMLElement>('[data-role="route"][data-rank="2"]')!.click()
    await flush()
    expect(window.location.hash).toBe('#silverstone/2')
  })

  describe('bookmarkable URL', () => {
    it('loading with #silverstone/2 selects that route', async () => {
      history.replaceState(null, '', '#silverstone/2')
      const c = await mount()
      expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('silverstone')
      expect(selectedRank(c)).toBe('2')
    })

    it('an unknown circuit falls back to the first available route', async () => {
      history.replaceState(null, '', '#nowhere/1')
      const c = await mount()
      expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('hungaroring')
      expect(selectedRank(c)).toBe('1')
      expect(window.location.hash).toBe('#hungaroring/1')
    })

    it('a circuit that exists but has no route file falls back too', async () => {
      history.replaceState(null, '', '#catalunya/1')
      const c = await mount()
      expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('hungaroring')
    })

    it('an unknown rank keeps the circuit and falls back to its first route', async () => {
      history.replaceState(null, '', '#silverstone/9')
      const c = await mount()
      expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('silverstone')
      expect(selectedRank(c)).toBe('1')
    })

    it('garbage in the hash does not break the page', async () => {
      history.replaceState(null, '', '#%%%/x')
      const c = await mount()
      expect(selectedRank(c)).toBe('1')
    })

    it('follows the hash when it changes after load', async () => {
      const c = await mount()
      history.replaceState(null, '', '#silverstone/2')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await flush()
      expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('silverstone')
      expect(selectedRank(c)).toBe('2')
    })
  })

  describe('GPX download', () => {
    it('creates a Blob of type application/gpx+xml and clicks an anchor named for the route', async () => {
      const createObjectURL = vi.fn((_: Blob | MediaSource) => 'blob:test')
      const revokeObjectURL = vi.fn()
      Object.assign(URL, { createObjectURL, revokeObjectURL })
      let clicked: HTMLAnchorElement | null = null
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this
      })

      history.replaceState(null, '', '#silverstone/2')
      const c = await mount()
      role<HTMLButtonElement>(c, 'download-gpx').click()

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0]![0] as Blob
      expect(blob.type).toBe('application/gpx+xml')
      const gpx = await blob.text()
      expect(gpx).toContain('<name>Silverstone Circuit — route 2</name>')
      // Stored ring (24 points) exported closed: 25 track points, last = first.
      const pts = [...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">/g)]
      expect(pts).toHaveLength(25)
      expect(pts[24]![0]).toBe(pts[0]![0])
      expect(clicked).not.toBeNull()
      expect(clicked!.download).toBe('silverstone-route-2.gpx')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    })

    it('is disabled while there is nothing selected', async () => {
      const c = await mount(deps({ availableIds: new Set() }))
      expect(role<HTMLButtonElement>(c, 'download-gpx').disabled).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('says so when no route has been generated at all', async () => {
      const c = await mount(deps({ availableIds: new Set() }))
      expect(role(c, 'message').textContent).toBe('No routes have been generated yet.')
      expect(panel(c).querySelectorAll('[data-role="route"]')).toHaveLength(0)
    })

    it('reports a route file that fails to load instead of breaking', async () => {
      const c = await mount(
        deps({
          loadRoutes: async () => {
            throw new Error('boom')
          },
        }),
      )
      expect(role(c, 'message').textContent).toContain('Could not load the routes for Hungaroring')
      expect(role<HTMLButtonElement>(c, 'download-gpx').disabled).toBe(true)
    })

    it('a slow earlier selection never overwrites a newer one', async () => {
      let releaseSlow: (f: RouteFile) => void = () => {}
      const slow = new Promise<RouteFile>((r) => (releaseSlow = r))
      const c = await mount(
        deps({
          loadRoutes: (id) => (id === 'silverstone' ? slow : Promise.resolve(FILES[id]!)),
        }),
      )
      const select = role<HTMLSelectElement>(c, 'circuit')
      select.value = 'silverstone'
      select.dispatchEvent(new Event('change'))
      panel(c).querySelector<HTMLElement>('[data-role="route"][data-rank="2"]')!.click()
      await flush()
      releaseSlow(FILES['silverstone']!)
      await flush()
      expect(role<HTMLSelectElement>(c, 'circuit').value).toBe('hungaroring')
      expect(selectedRank(c)).toBe('2')
    })

    it('removes its map and DOM when destroyed, and destroying twice is harmless', async () => {
      const container = await mount()
      pages[0]!.destroy()
      expect(container.querySelector('.leaflet-container')).toBeNull()
      expect(container.children).toHaveLength(0)
      expect(() => pages[0]!.destroy()).not.toThrow()
    })
  })
})

// The committed route files, through the same page code: cheap (no search) and
// offline. Phase 22's routes.test.ts already validates the files themselves;
// this proves the page can show every one of them, and that the outline it
// draws is where the generator measured it.
describe('committed route files, on the page', () => {
  const modules = import.meta.glob('../data/routes/*.json', { eager: true }) as Record<string, { default: unknown }>
  const files = Object.values(modules).map((m) => loadRouteFile(m.default))
  const project = portoProjection()

  it('has route files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('renders every route of every file without throwing', async () => {
    const byId = new Map(files.map((f) => [f.circuitId, f]))
    const c = await mount({ availableIds: new Set(byId.keys()), loadRoutes: async (id) => byId.get(id)! })
    for (const file of files) {
      const select = role<HTMLSelectElement>(c, 'circuit')
      select.value = file.circuitId
      select.dispatchEvent(new Event('change'))
      await flush()
      for (const route of file.routes) {
        panel(c).querySelector<HTMLElement>(`[data-role="route"][data-rank="${route.rank}"]`)!.click()
        await flush()
        expect(role(c, 'badge').textContent).toMatch(/the bar$/)
        expect(byStroke(c, ROUTE_STROKE)).toHaveLength(1)
        expect(byStroke(c, OUTLINE_STROKE)).toHaveLength(1)
      }
    }
  })

  it('draws the outline where the generator measured it (mean deviation matches the stored figure)', () => {
    for (const file of files) {
      const metric = circuits.find((x) => x.id === file.circuitId)!
      for (const route of file.routes) {
        const outlineM = overlayLatLngs(metric, {
          anchor: route.pose.anchor,
          rotationRad: route.pose.rotationRad,
          scale: file.scale,
        }).map((p) => project.toLocal(p))
        const routeM = route.points.map((p) => project.toLocal(p))
        const closedRouteM = [...routeM, routeM[0]!]
        const { meanM } = routeDeviation(closedRouteM, outlineM)
        expect(Math.abs(meanM - route.metrics.meanDeviationM), `${file.circuitId} #${route.rank}`).toBeLessThan(3)
        expect(Math.abs(pathLength(closedRouteM, false) - route.metrics.lengthM)).toBeLessThan(5)
      }
    }
  })
})
