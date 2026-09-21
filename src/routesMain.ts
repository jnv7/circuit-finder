// Entry point of `routes.html` (Phase 23). Route files are lazy chunks — one
// per circuit, fetched only when that circuit is selected — and validated on
// load with the same `loadRouteFile` the tests use.
import 'leaflet/dist/leaflet.css'
import './style.css'
import { loadMetricCircuits } from './circuits'
import { createRoutesPage } from './app/routesPage'
import { loadRouteFile } from './routes'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('missing #app element')
}

const loaders = import.meta.glob<{ default: unknown }>('./data/routes/*.json')
const loaderById = new Map<string, () => Promise<{ default: unknown }>>()
for (const [path, load] of Object.entries(loaders)) {
  const id = path.split('/').pop()!.replace(/\.json$/, '')
  loaderById.set(id, load)
}

createRoutesPage(app, loadMetricCircuits(), {
  availableIds: new Set(loaderById.keys()),
  async loadRoutes(circuitId) {
    const load = loaderById.get(circuitId)
    if (!load) throw new Error(`no route file for ${circuitId}`)
    return loadRouteFile((await load()).default)
  },
})
