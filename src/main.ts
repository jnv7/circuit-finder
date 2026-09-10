import 'leaflet/dist/leaflet.css'
import './style.css'
import { loadMetricCircuits } from './circuits'
import { createMapApp } from './app/map'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('missing #app element')
}

createMapApp(app, loadMetricCircuits())
