// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { formatDistance, readout } from '../app/overlay'
import { makeSavedPlacement } from '../placements'
import { bind, formatSavedAgo, renderControls, updateReadout } from './controls'

const circuits = loadMetricCircuits()
const view = (over: Partial<Parameters<typeof renderControls>[0]> = {}) => ({
  circuits,
  selectedId: circuits[0]!.id,
  scale: 1,
  showStreets: true,
  saved: null,
  hasUnsavedChanges: true,
  previewingSaved: false,
  ...over,
})

const savedFor = (id: string, savedAt: string) => ({
  ...makeSavedPlacement(id, { anchor: [-8.61, 41.15], rotationRad: 0.2, scale: 1.5 }, new Date()),
  savedAt,
})

const noopHandlers = () => ({
  onSelectCircuit: vi.fn(),
  onScaleChange: vi.fn(),
  onToggleStreets: vi.fn(),
  onSave: vi.fn(),
  onRevertToSaved: vi.fn(),
  onDeleteSaved: vi.fn(),
  onTogglePreviewSaved: vi.fn(),
})

describe('renderControls', () => {
  it('renders one option per circuit, marking the selected one', () => {
    const html = renderControls(view({ selectedId: circuits[1]!.id }))
    for (const c of circuits) {
      expect(html).toContain(`<option value="${c.id}"`)
      expect(html).toContain(`>${c.name}</option>`)
    }
    expect(html).toContain(`value="${circuits[1]!.id}" selected`)
  })

  it('shows the formatted readout for the selected circuit and scale', () => {
    const circuit = circuits[0]!
    const html = renderControls(view({ scale: 2 }))
    const { lapM, straightM } = readout(circuit, 2)
    expect(html).toContain(formatDistance(lapM))
    expect(html).toContain(formatDistance(straightM))
  })

  it('renders the proximity cell, the legend, and a checked streets toggle', () => {
    const html = renderControls(view())
    expect(html).toContain('data-role="proximity"')
    expect(html).toContain('class="legend"')
    expect(html).toContain('on a street')
    expect(html).toContain('off-street')
    expect(html).toContain('data-role="streets"')
    expect(html).toMatch(/data-role="streets"[^>]*checked/)
  })

  it('leaves the streets toggle unchecked when showStreets is false', () => {
    const html = renderControls(view({ showStreets: false }))
    expect(html).not.toMatch(/data-role="streets"[^>]*checked/)
  })
})

describe('renderControls — saved placement section', () => {
  it('always shows a Save button', () => {
    expect(renderControls(view())).toContain('data-role="save"')
  })

  it('says "Not saved yet" and hides revert/delete/preview when nothing is saved', () => {
    const html = renderControls(view({ saved: null }))
    expect(html).toContain('Not saved yet')
    expect(html).not.toContain('data-role="revert"')
    expect(html).not.toContain('data-role="delete-saved"')
    expect(html).not.toContain('data-role="preview-saved"')
  })

  it('shows the saved age plus revert and delete when a placement is saved', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')
    const html = renderControls(
      view({
        saved: savedFor(circuits[0]!.id, '2026-09-10T11:58:00.000Z'),
        now,
      }),
    )
    expect(html).toContain('Saved 2 min ago')
    expect(html).toContain('data-role="revert"')
    expect(html).toContain('data-role="delete-saved"')
  })

  it('shows the preview toggle only with unsaved changes', () => {
    const saved = savedFor(circuits[0]!.id, '2026-09-10T11:58:00.000Z')
    expect(renderControls(view({ saved, hasUnsavedChanges: true }))).toContain(
      'data-role="preview-saved"',
    )
    expect(renderControls(view({ saved, hasUnsavedChanges: false }))).not.toContain(
      'data-role="preview-saved"',
    )
  })

  it('checks the preview toggle when previewingSaved is on', () => {
    const saved = savedFor(circuits[0]!.id, '2026-09-10T11:58:00.000Z')
    const html = renderControls(view({ saved, hasUnsavedChanges: true, previewingSaved: true }))
    expect(html).toMatch(/data-role="preview-saved"[^>]*checked/)
  })
})

describe('formatSavedAgo', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')
  it.each([
    ['2026-09-10T11:59:30.000Z', 'just now'],
    ['2026-09-10T11:45:00.000Z', '15 min ago'],
    ['2026-09-10T09:00:00.000Z', '3 h ago'],
    ['2026-09-08T12:00:00.000Z', '2 d ago'],
    ['2026-08-20T12:00:00.000Z', 'on 2026-08-20'],
  ])('%s → %s', (savedAt, expected) => {
    expect(formatSavedAgo(savedAt, now)).toBe(expected)
  })
})

describe('bind', () => {
  it('calls the handlers on change', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view())
    const handlers = noopHandlers()
    const dispose = bind(root, handlers)

    const select = root.querySelector<HTMLSelectElement>('[data-role="circuit"]')!
    select.value = circuits[2]!.id
    select.dispatchEvent(new Event('change'))
    expect(handlers.onSelectCircuit).toHaveBeenCalledWith(circuits[2]!.id)

    const scale = root.querySelector<HTMLInputElement>('[data-role="scale"]')!
    scale.value = '1.5'
    scale.dispatchEvent(new Event('change'))
    expect(handlers.onScaleChange).toHaveBeenCalledWith(1.5)

    const streets = root.querySelector<HTMLInputElement>('[data-role="streets"]')!
    streets.checked = false
    streets.dispatchEvent(new Event('change'))
    expect(handlers.onToggleStreets).toHaveBeenCalledWith(false)

    root.querySelector<HTMLButtonElement>('[data-role="save"]')!.dispatchEvent(new Event('click'))
    expect(handlers.onSave).toHaveBeenCalledTimes(1)

    dispose()
    select.dispatchEvent(new Event('change'))
    expect(handlers.onSelectCircuit).toHaveBeenCalledTimes(1)
  })

  it('wires revert, delete and the preview toggle when a placement is saved', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(
      view({ saved: savedFor(circuits[0]!.id, new Date().toISOString()), hasUnsavedChanges: true }),
    )
    const handlers = noopHandlers()
    bind(root, handlers)

    root.querySelector<HTMLButtonElement>('[data-role="revert"]')!.dispatchEvent(new Event('click'))
    expect(handlers.onRevertToSaved).toHaveBeenCalledTimes(1)

    root
      .querySelector<HTMLButtonElement>('[data-role="delete-saved"]')!
      .dispatchEvent(new Event('click'))
    expect(handlers.onDeleteSaved).toHaveBeenCalledTimes(1)

    const preview = root.querySelector<HTMLInputElement>('[data-role="preview-saved"]')!
    preview.checked = true
    preview.dispatchEvent(new Event('change'))
    expect(handlers.onTogglePreviewSaved).toHaveBeenCalledWith(true)
  })
})

describe('updateReadout', () => {
  it('rewrites just the readout cells, including % near a street', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view())
    updateReadout(root, { lapM: 1850, straightM: 940, nearFraction: 0.42 })
    expect(root.querySelector('[data-role="lap"]')!.textContent).toBe('1.85 km')
    expect(root.querySelector('[data-role="straight"]')!.textContent).toBe('940 m')
    expect(root.querySelector('[data-role="proximity"]')!.textContent).toBe('42%')
  })
})
