// Phase 26: load any region's full street network for the generator.
// Dev-only (Node `fs`) — never imported by the browser app, which only ever
// needs `src/regions.ts`'s lightweight id/label/bbox list, not the street
// data itself.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bboxCenterProjection } from '../../src/geo'
import type { LocalProjection } from '../../src/geo'
import { portoProjection } from '../../src/porto'
import type { RegionId } from '../../src/regions'
import { loadStreetNetwork, validateStreetNetwork } from '../../src/streets'
import type { StreetNetwork } from '../../src/streets'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type RegionNetwork = { network: StreetNetwork; project: LocalProjection }

/**
 * `porto` loads the bundled `regions/porto-streets.json` with its own fixed-origin
 * projection (`portoProjection`, unchanged default). Every other region loads
 * its committed `src/data/regions/<id>-streets.json` and projects it about
 * its own bbox centre (`bboxCenterProjection`), so a region tens of km from
 * Porto never inherits Porto's projection distortion. The projection is
 * returned alongside the network — the caller needs the exact same one to
 * place generated routes back onto real [lon, lat].
 */
export function loadRegionStreetNetwork(id: RegionId): RegionNetwork {
  if (id === 'porto') {
    const project = portoProjection()
    return { network: loadStreetNetwork(undefined, project), project }
  }
  const raw = readFileSync(path.join(__dirname, `../../src/data/regions/${id}-streets.json`), 'utf8')
  const data = JSON.parse(raw)
  const { bbox } = validateStreetNetwork(data)
  const project = bboxCenterProjection(bbox)
  return { network: loadStreetNetwork(data, project), project }
}
