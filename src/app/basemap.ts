// The OSM raster basemap shared by both pages (the tool and the routes page).
// Kept out of `map.ts` so the routes page can reuse it without bundling the
// whole tool (street network, graph, search) behind it.
import L from 'leaflet'

export const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function addBasemap(map: L.Map): void {
  L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map)
}
