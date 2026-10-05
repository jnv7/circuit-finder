// Entry point of `index.html` (Phase 28) — the circuit list, now the site's
// primary entry. Each circuit links into the routes page (`routesMain.ts`) for
// it, or shows disabled when no route has been generated yet.
import './style.css'
import { loadMetricCircuits } from './circuits'
import { createHomePage } from './app/homePage'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('missing #app element')
}

const loaders = import.meta.glob<unknown>('./data/routes/*.json')
const availableIds = new Set([...Object.keys(loaders)].map((path) => path.split('/').pop()!.replace(/\.json$/, '')))

createHomePage(app, loadMetricCircuits(), { availableIds })
