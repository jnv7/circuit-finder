// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { loadMetricCircuits } from '../circuits'
import { formatDistance, readout } from '../app/overlay'
import { makeSavedPlacement } from '../placements'
import {
  bind,
  formatDeviation,
  formatRouteLength,
  formatSavedAgo,
  formatSuggestionLabel,
  renderControls,
  updateReadout,
} from './controls'

const circuits = loadMetricCircuits()
const idleSuggest = {
  phase: 'idle' as const,
  suggestions: [] as const,
  selectedIndex: null,
}
const sampleSuggestion = (over: Record<string, unknown> = {}) => ({
  placement: { anchor: [-8.61, 41.15] as [number, number], rotationRad: 0.1, scale: 1 },
  coverageFraction: 0.78,
  meanDeviationM: 24,
  maxDeviationM: 61,
  ...over,
})
const view = (over: Partial<Parameters<typeof renderControls>[0]> = {}) => ({
  circuits,
  selectedId: circuits[0]!.id,
  scale: 1,
  showStreets: true,
  saved: null,
  hasUnsavedChanges: true,
  previewingSaved: false,
  tracing: false,
  studyView: false,
  routePointCount: 0,
  routeStats: null,
  circuitLengthM: 4000,
  suggest: idleSuggest,
  ...over,
})

const stats = { lengthM: 3440, meanDeviationM: 45.2, maxDeviationM: 160.8 }

const savedFor = (id: string, savedAt: string) => ({
  ...makeSavedPlacement(id, { anchor: [-8.61, 41.15], rotationRad: 0.2, scale: 1.5 }, [], new Date()),
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
  onToggleTrace: vi.fn(),
  onUndoRoutePoint: vi.fn(),
  onClearRoute: vi.fn(),
  onToggleStudyView: vi.fn(),
  onSuggest: vi.fn(),
  onCancelSuggest: vi.fn(),
  onUseSuggestion: vi.fn(),
  onPreviewSuggestion: vi.fn(),
  onClearSuggestions: vi.fn(),
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

  it('wires trace / undo / clear / study and study-exit', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view({ tracing: true, routePointCount: 2, routeStats: stats }))
    const handlers = noopHandlers()
    bind(root, handlers)

    for (const [role, fn] of [
      ['trace', 'onToggleTrace'],
      ['undo-point', 'onUndoRoutePoint'],
      ['clear-route', 'onClearRoute'],
      ['study', 'onToggleStudyView'],
    ] as const) {
      root.querySelector<HTMLButtonElement>(`[data-role="${role}"]`)!.dispatchEvent(new Event('click'))
      expect(handlers[fn]).toHaveBeenCalledTimes(1)
    }

    const study = document.createElement('div')
    study.innerHTML = renderControls(view({ studyView: true, routeStats: stats }))
    const h2 = noopHandlers()
    bind(study, h2)
    study.querySelector<HTMLButtonElement>('[data-role="study-exit"]')!.dispatchEvent(new Event('click'))
    expect(h2.onToggleStudyView).toHaveBeenCalledTimes(1)
  })
})

describe('updateReadout', () => {
  it('rewrites just the readout cells, including % near a street', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view())
    updateReadout(root, {
      lapM: 1850,
      straightM: 940,
      nearFraction: 0.42,
      routeStats: null,
      circuitLengthM: 4000,
    })
    expect(root.querySelector('[data-role="lap"]')!.textContent).toBe('1.85 km')
    expect(root.querySelector('[data-role="straight"]')!.textContent).toBe('940 m')
    expect(root.querySelector('[data-role="proximity"]')!.textContent).toBe('42%')
  })

  it('rewrites the route cells when stats are present', () => {
    const root = document.createElement('div')
    root.innerHTML = renderControls(view({ routeStats: stats, circuitLengthM: 4000 }))
    updateReadout(root, {
      lapM: 1,
      straightM: 1,
      nearFraction: 0,
      routeStats: { lengthM: 5000, meanDeviationM: 10, maxDeviationM: 20 },
      circuitLengthM: 4000,
    })
    expect(root.querySelector('[data-role="route-length"]')!.textContent).toContain('+25%')
    expect(root.querySelector('[data-role="route-deviation"]')!.textContent).toBe(
      '~10 m avg · 20 m max',
    )
  })
})

describe('renderControls — route section', () => {
  it('shows the Trace button, label following tracing', () => {
    expect(renderControls(view({ tracing: false }))).toContain('>Trace route<')
    expect(renderControls(view({ tracing: true }))).toContain('>Stop tracing<')
  })

  it('shows undo/clear and a point count only while tracing, disabled at 0', () => {
    expect(renderControls(view({ tracing: false }))).not.toContain('data-role="undo-point"')
    const html = renderControls(view({ tracing: true, routePointCount: 0 }))
    expect(html).toMatch(/data-role="undo-point"[^>]*disabled/)
    expect(html).toContain('0 points')
    const html2 = renderControls(view({ tracing: true, routePointCount: 3 }))
    expect(html2).not.toMatch(/data-role="undo-point"[^>]*disabled/)
    expect(html2).toContain('3 points')
  })

  it('shows the stats and Study button only with a non-null routeStats', () => {
    expect(renderControls(view({ routeStats: null }))).not.toContain('data-role="study"')
    const html = renderControls(view({ routeStats: stats }))
    expect(html).toContain('data-role="route-length"')
    expect(html).toContain('data-role="route-deviation"')
    expect(html).toContain('data-role="study"')
  })
})

describe('renderControls — study view', () => {
  it('renders only the study summary and an exit button', () => {
    const html = renderControls(view({ studyView: true, routeStats: stats }))
    expect(html).toContain('data-role="study-summary"')
    expect(html).toContain('data-role="study-exit"')
    expect(html).toContain('data-role="route-length"')
    expect(html).not.toContain('data-role="circuit"')
    expect(html).not.toContain('data-role="save"')
  })
})

describe('renderControls — suggest placements section', () => {
  it('idle: renders the opt-in button, disabled while tracing or previewing', () => {
    expect(renderControls(view())).toMatch(/data-role="suggest"(?![^>]*disabled)/)
    expect(renderControls(view({ tracing: true }))).toMatch(/data-role="suggest"[^>]*disabled/)
    expect(renderControls(view({ previewingSaved: true }))).toMatch(
      /data-role="suggest"[^>]*disabled/,
    )
  })

  it('running: renders a progress bar bound to progress and a cancel button', () => {
    const html = renderControls(
      view({
        suggest: {
          phase: 'running',
          progress: { done: 3, total: 8, phase: 'search' },
          suggestions: [],
          selectedIndex: null,
        },
      }),
    )
    expect(html).toMatch(/data-role="suggest-progress"[^>]*value="3"[^>]*max="8"/)
    expect(html).toContain('data-role="suggest-cancel"')
    expect(html).not.toContain('data-role="suggest"')
  })

  it('running: shows a phase label that switches between search and route', () => {
    const searching = renderControls(
      view({
        suggest: {
          phase: 'running',
          progress: { done: 1, total: 8, phase: 'search' },
          suggestions: [],
          selectedIndex: null,
        },
      }),
    )
    expect(searching).toContain('Searching placements')
    const routing = renderControls(
      view({
        suggest: {
          phase: 'running',
          progress: { done: 1, total: 8, phase: 'route' },
          suggestions: [],
          selectedIndex: null,
        },
      }),
    )
    expect(routing).toContain('Checking routes')
  })

  it('results: one row per suggestion with the coverage label, use and clear buttons', () => {
    const suggestions = [sampleSuggestion(), sampleSuggestion({ coverageFraction: 0.5 })]
    const html = renderControls(
      view({ suggest: { phase: 'results', suggestions, selectedIndex: 1 } }),
    )
    expect(html).toContain('data-role="suggest-list"')
    expect(html).toContain(formatSuggestionLabel(suggestions[0]!))
    expect((html.match(/data-role="suggest-use"/g) ?? []).length).toBe(2)
    expect(html).toContain('data-suggest-index="1"')
    expect(html).toContain('suggest__row--selected')
    expect(html).toContain('data-role="suggest-clear"')
  })

  it('results: renders the right label for a simple loop, a non-simple loop, a best-effort loop, and a fallback row', () => {
    const suggestions = [
      sampleSuggestion({
        loop: { points: [], lengthM: 3400, meanDeviationM: 12, maxDeviationM: 30, simple: true },
      }),
      sampleSuggestion({
        loop: { points: [], lengthM: 3400, meanDeviationM: 12, maxDeviationM: 30, simple: false },
      }),
      sampleSuggestion({
        bestEffort: {
          legs: [],
          points: [],
          lengthM: 3100,
          meanDeviationM: 14,
          maxDeviationM: 40,
          gapLengthM: 180,
          gapCount: 2,
        },
      }),
      sampleSuggestion(),
    ]
    const html = renderControls(
      view({ suggest: { phase: 'results', suggestions, selectedIndex: null } }),
    )
    expect(html).toContain('closed loop')
    expect(html).toContain('retraces a street')
    expect(html).toContain('2 street gaps')
    expect(html).toContain('on streets')
    expect((html.match(/data-role="suggest-use"/g) ?? []).length).toBe(4)
  })

  it('results: shows an empty note when the search found nothing', () => {
    const html = renderControls(
      view({ suggest: { phase: 'results', suggestions: [], selectedIndex: null } }),
    )
    expect(html).toContain('data-role="suggest-clear"')
    expect(html).not.toContain('data-role="suggest-list"')
    expect(html).toContain('suggest__empty')
  })
})

describe('formatSuggestionLabel', () => {
  it('a fallback suggestion (no loop) shows a rounded percentage and average deviation', () => {
    expect(
      formatSuggestionLabel({
        placement: { anchor: [0, 0], rotationRad: 0, scale: 1 },
        coverageFraction: 0.734,
        meanDeviationM: 18.6,
        maxDeviationM: 40,
      }),
    ).toBe('73% on streets · ~19 m avg')
  })

  it('a simple routed loop shows its real length and deviation, no coverage', () => {
    const label = formatSuggestionLabel({
      placement: { anchor: [0, 0], rotationRad: 0, scale: 1 },
      coverageFraction: 1,
      meanDeviationM: 5,
      maxDeviationM: 10,
      loop: { points: [], lengthM: 3400, meanDeviationM: 12.4, maxDeviationM: 30, simple: true },
    })
    expect(label).toContain('closed loop')
    expect(label).not.toContain('retraces')
    expect(label).not.toContain('on streets')
    expect(label).toContain('~12 m avg')
  })

  it('a non-simple routed loop is visibly flagged as retracing a street', () => {
    const label = formatSuggestionLabel({
      placement: { anchor: [0, 0], rotationRad: 0, scale: 1 },
      coverageFraction: 1,
      meanDeviationM: 5,
      maxDeviationM: 10,
      loop: { points: [], lengthM: 3400, meanDeviationM: 12.4, maxDeviationM: 30, simple: false },
    })
    expect(label).toContain('retraces a street')
  })

  it('a best-effort loop reads distance, gap count/length, then deviation, no coverage', () => {
    const label = formatSuggestionLabel({
      placement: { anchor: [0, 0], rotationRad: 0, scale: 1 },
      coverageFraction: 0.5,
      meanDeviationM: 5,
      maxDeviationM: 10,
      bestEffort: {
        legs: [],
        points: [],
        lengthM: 3100,
        meanDeviationM: 14,
        maxDeviationM: 40,
        gapLengthM: 180,
        gapCount: 2,
      },
    })
    expect(label).toBe('3.10 km loop · 2 street gaps (180 m) · ~14 m off shape')
  })

  it('a single street gap reads in the singular', () => {
    const label = formatSuggestionLabel({
      placement: { anchor: [0, 0], rotationRad: 0, scale: 1 },
      coverageFraction: 0.5,
      meanDeviationM: 5,
      maxDeviationM: 10,
      bestEffort: {
        legs: [],
        points: [],
        lengthM: 1000,
        meanDeviationM: 8,
        maxDeviationM: 20,
        gapLengthM: 50,
        gapCount: 1,
      },
    })
    expect(label).toContain('1 street gap (50 m)')
    expect(label).not.toContain('gaps')
  })
})

describe('bind — suggest section', () => {
  it('wires the button, cancel, clear, per-row use and hover preview', () => {
    const suggestions = [sampleSuggestion(), sampleSuggestion()]

    const idle = document.createElement('div')
    idle.innerHTML = renderControls(view())
    const h1 = noopHandlers()
    bind(idle, h1)
    idle.querySelector<HTMLButtonElement>('[data-role="suggest"]')!.dispatchEvent(new Event('click'))
    expect(h1.onSuggest).toHaveBeenCalledTimes(1)

    const running = document.createElement('div')
    running.innerHTML = renderControls(
      view({
        suggest: {
          phase: 'running',
          progress: { done: 1, total: 2, phase: 'search' },
          suggestions: [],
          selectedIndex: null,
        },
      }),
    )
    const h2 = noopHandlers()
    bind(running, h2)
    running
      .querySelector<HTMLButtonElement>('[data-role="suggest-cancel"]')!
      .dispatchEvent(new Event('click'))
    expect(h2.onCancelSuggest).toHaveBeenCalledTimes(1)

    const results = document.createElement('div')
    results.innerHTML = renderControls(
      view({ suggest: { phase: 'results', suggestions, selectedIndex: null } }),
    )
    const h3 = noopHandlers()
    bind(results, h3)

    const useButtons = results.querySelectorAll<HTMLButtonElement>('[data-role="suggest-use"]')
    useButtons[1]!.dispatchEvent(new Event('click'))
    expect(h3.onUseSuggestion).toHaveBeenCalledWith(1)

    const rows = results.querySelectorAll<HTMLLIElement>('li[data-suggest-index]')
    rows[0]!.dispatchEvent(new Event('mouseenter'))
    expect(h3.onPreviewSuggestion).toHaveBeenCalledWith(0)
    results.querySelector('[data-role="suggest-list"]')!.dispatchEvent(new Event('mouseleave'))
    expect(h3.onPreviewSuggestion).toHaveBeenCalledWith(null)

    results
      .querySelector<HTMLButtonElement>('[data-role="suggest-clear"]')!
      .dispatchEvent(new Event('click'))
    expect(h3.onClearSuggestions).toHaveBeenCalledTimes(1)
  })
})

describe('formatRouteLength / formatDeviation', () => {
  it('signs the % difference and rounds the deviation', () => {
    expect(formatRouteLength({ lengthM: 3600, meanDeviationM: 0, maxDeviationM: 0 }, 4000)).toContain(
      '−10%',
    )
    expect(formatRouteLength({ lengthM: 4400, meanDeviationM: 0, maxDeviationM: 0 }, 4000)).toContain(
      '+10%',
    )
    expect(formatDeviation({ lengthM: 0, meanDeviationM: 44.6, maxDeviationM: 161.2 })).toBe(
      '~45 m avg · 161 m max',
    )
  })
})
