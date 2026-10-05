// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import type { MetricCircuit } from '../circuits'
import { createHomePage } from './homePage'

const circuits = loadMetricCircuits()
const allAvailable = { availableIds: new Set(circuits.map((c) => c.id)) }

function makeCircuit(id: string, name: string): MetricCircuit {
  const base = circuits[0]!
  return { ...base, id, name }
}

describe('createHomePage', () => {
  it('renders one card per circuit, each naming its display name and id', () => {
    const container = document.createElement('div')
    createHomePage(container, circuits, allAvailable)

    const cards = container.querySelectorAll('.home-card')
    expect(cards).toHaveLength(circuits.length)
    cards.forEach((card, i) => {
      const circuit = circuits[i]!
      expect(card.getAttribute('data-circuit-id')).toBe(circuit.id)
      expect(card.querySelector('.home-card__name')?.textContent).toBe(circuit.name)
      expect(card.querySelector('.home-card__id')?.textContent).toBe(circuit.id)
    })
  })

  it('draws a non-empty closed SVG path for every circuit', () => {
    const container = document.createElement('div')
    createHomePage(container, circuits, allAvailable)

    for (const card of container.querySelectorAll('.home-card')) {
      const d = card.querySelector('.home-card__path')?.getAttribute('d')
      expect(d).toBeTruthy()
      expect(d).toMatch(/^M [\d.]+ [\d.]+ (L [\d.]+ [\d.]+ )*L [\d.]+ [\d.]+$/)
    }
  })

  it('throws on an empty circuit list rather than rendering a blank page', () => {
    const container = document.createElement('div')
    expect(() => createHomePage(container, [], allAvailable)).toThrow()
  })

  it('keeps two circuits of the same shape visually distinct by name/id only', () => {
    // Guards against the labels silently collapsing when geometry matches.
    const container = document.createElement('div')
    const two = [makeCircuit('a', 'Circuit A'), makeCircuit('b', 'Circuit B')]
    createHomePage(container, two, { availableIds: new Set(two.map((c) => c.id)) })
    const names = [...container.querySelectorAll('.home-card__name')].map((n) => n.textContent)
    expect(names).toEqual(['Circuit A', 'Circuit B'])
  })

  it('destroy() clears the container and its marker class', () => {
    const container = document.createElement('div')
    const page = createHomePage(container, circuits, allAvailable)
    page.destroy()
    expect(container.children).toHaveLength(0)
    expect(container.classList.contains('home-page')).toBe(false)
  })

  describe('linking to the routes page', () => {
    it('a circuit with a generated route is a link to its routes-page hash', () => {
      const container = document.createElement('div')
      const [circuit] = circuits
      createHomePage(container, circuits, { availableIds: new Set([circuit!.id]) })

      const card = container.querySelector(`[data-circuit-id="${circuit!.id}"]`)!
      expect(card.tagName).toBe('A')
      expect(card.getAttribute('href')).toBe(`routes.html#${circuit!.id}`)
      expect(card.hasAttribute('aria-disabled')).toBe(false)
    })

    it('a circuit with no generated route is disabled and not a link', () => {
      const container = document.createElement('div')
      const [circuit] = circuits
      createHomePage(container, circuits, { availableIds: new Set() })

      const card = container.querySelector(`[data-circuit-id="${circuit!.id}"]`)!
      expect(card.tagName).not.toBe('A')
      expect(card.hasAttribute('href')).toBe(false)
      expect(card.getAttribute('aria-disabled')).toBe('true')
      expect(card.classList.contains('home-card--disabled')).toBe(true)
      expect(card.querySelector('.home-card__status')?.textContent).toBe('No route generated yet')
    })
  })
})
