// Phase 28: the production home page (index.html) — one card per bundled
// circuit, its centreline drawn to its own scale, labelled with the display
// name and the `circuits.json` id. A circuit with a generated route links to
// the routes page for it; one without a route yet is shown disabled, not
// clickable — there is nothing to look up there yet.
import type { MetricCircuit } from '../circuits'
import type { Point } from '../geometry/types'
import { formatCircuitHash } from './routesHash'

const SVG_NS = 'http://www.w3.org/2000/svg'
const VIEWPORT = 220
const PADDING = 14

export type HomePageDeps = {
  /** Circuit ids that have a stored route file — the ones a card can link to. */
  availableIds: ReadonlySet<string>
}

export type HomePage = {
  destroy(): void
}

function closed(points: readonly Point[]): Point[] {
  return points.length > 0 ? [...points, points[0]!] : []
}

function bounds(points: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** `d` attribute for the centreline, autofit to a square viewport, north up. */
function pathD(points: readonly Point[]): string {
  const { minX, minY, maxX, maxY } = bounds(points)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const span = Math.max(spanX, spanY)
  const scale = (VIEWPORT - PADDING * 2) / span
  const offsetX = PADDING + ((span - spanX) * scale) / 2
  const offsetY = PADDING + ((span - spanY) * scale) / 2
  const toSvg = ([x, y]: Point): Point => [offsetX + (x - minX) * scale, offsetY + (maxY - y) * scale]

  const ring = closed(points).map(toSvg)
  const [first, ...rest] = ring
  if (!first) return ''
  const fmt = (n: number): string => n.toFixed(1)
  return `M ${fmt(first[0])} ${fmt(first[1])} ` + rest.map(([x, y]) => `L ${fmt(x)} ${fmt(y)}`).join(' ')
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, textContent?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (textContent !== undefined) node.textContent = textContent
  return node
}

function circuitCard(circuit: MetricCircuit, available: boolean): HTMLElement {
  const card = available ? el('a', 'home-card') : el('article', 'home-card home-card--disabled')
  card.dataset.circuitId = circuit.id

  if (available) {
    ;(card as HTMLAnchorElement).href = `routes.html${formatCircuitHash({ circuitId: circuit.id })}`
  } else {
    card.setAttribute('aria-disabled', 'true')
  }

  card.append(el('h2', 'home-card__name', circuit.name), el('p', 'home-card__id', circuit.id))

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${VIEWPORT} ${VIEWPORT}`)
  svg.setAttribute('class', 'home-card__shape')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('class', 'home-card__path')
  path.setAttribute('d', pathD(circuit.metricCentreline))
  svg.append(path)
  card.append(svg)

  card.append(
    el(
      'p',
      'home-card__length',
      `${Math.round(circuit.lengthM)} m centreline (official ${circuit.officialLengthM} m) · ${circuit.metricCentreline.length} points`,
    ),
  )
  if (!available) card.append(el('p', 'home-card__status', 'No route generated yet'))

  return card
}

export function createHomePage(container: HTMLElement, circuits: readonly MetricCircuit[], deps: HomePageDeps): HomePage {
  if (circuits.length === 0) throw new Error('createHomePage: no circuits')

  container.classList.add('home-page')
  const grid = el('div', 'home-grid')
  for (const circuit of circuits) grid.append(circuitCard(circuit, deps.availableIds.has(circuit.id)))

  container.append(el('h1', 'home-heading', `Circuits (${circuits.length})`), grid)

  return {
    destroy() {
      container.replaceChildren()
      container.classList.remove('home-page')
    },
  }
}
