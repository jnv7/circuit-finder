import { describe, it, expect, vi, afterEach } from 'vitest'
import type { StreetGraph } from '../graph'
import type {
  LoopSearchProgress,
  RoutedSuggestion,
  SearchInput,
  SearchProgress,
  Suggestion,
} from '../match/types'
import { createLoopSuggester, createSuggester } from './suggest'

const searchPlacementsMock = vi.hoisted(() => vi.fn())
vi.mock('../match/search', () => ({ searchPlacements: searchPlacementsMock }))
const searchRoutedLoopsMock = vi.hoisted(() => vi.fn())
vi.mock('../match/loopSearch', () => ({ searchRoutedLoops: searchRoutedLoopsMock }))

const SUGGESTIONS: Suggestion[] = [
  {
    placement: { anchor: [-8.6, 41.16], rotationRad: 0.2, scale: 1 },
    coverageFraction: 0.7,
    meanDeviationM: 22,
    maxDeviationM: 60,
  },
]

const ROUTED_SUGGESTIONS: RoutedSuggestion[] = [{ ...SUGGESTIONS[0]! }]

// `SearchInput` / `StreetGraph` are opaque to the driver; a bare object is
// enough for the mock.
const input = {} as SearchInput
const graph = {} as StreetGraph

afterEach(() => {
  vi.useRealTimers()
  searchPlacementsMock.mockReset()
  searchRoutedLoopsMock.mockReset()
})

describe('createSuggester', () => {
  it('resolves with the generator result and reports progress ending at done === total', async () => {
    searchPlacementsMock.mockImplementation(function* (): Generator<SearchProgress, Suggestion[]> {
      yield { done: 1, total: 3 }
      yield { done: 2, total: 3 }
      yield { done: 3, total: 3 }
      return SUGGESTIONS
    })

    const onProgress = vi.fn()
    const result = await createSuggester().run(input, onProgress)

    expect(result).toEqual(SUGGESTIONS)
    expect(onProgress).toHaveBeenCalled()
    expect(onProgress).toHaveBeenLastCalledWith({ done: 3, total: 3 })
  })

  it('cancel() mid-run resolves with [] and leaves no pending timer', async () => {
    searchPlacementsMock.mockImplementation(function* (): Generator<SearchProgress, Suggestion[]> {
      // Never completes on its own — only the driver's slicing + cancel stop it.
      while (true) yield { done: 0, total: 1 }
    })

    vi.useFakeTimers()
    const suggester = createSuggester()
    const promise = suggester.run(input, () => {})

    // The first burst ran synchronously and the driver is now parked on its
    // between-bursts macrotask.
    expect(vi.getTimerCount()).toBe(1)

    suggester.cancel()
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a fresh run after cancel() starts clean', async () => {
    searchPlacementsMock.mockImplementation(function* (): Generator<SearchProgress, Suggestion[]> {
      yield { done: 1, total: 1 }
      return SUGGESTIONS
    })
    const suggester = createSuggester()
    suggester.cancel()
    await expect(suggester.run(input, () => {})).resolves.toEqual(SUGGESTIONS)
  })
})

describe('createLoopSuggester', () => {
  it('resolves with the generator result and reports progress ending at done === total', async () => {
    searchRoutedLoopsMock.mockImplementation(function* (): Generator<
      LoopSearchProgress,
      RoutedSuggestion[]
    > {
      yield { done: 1, total: 3, phase: 'search' }
      yield { done: 1, total: 2, phase: 'route' }
      yield { done: 2, total: 2, phase: 'route' }
      return ROUTED_SUGGESTIONS
    })

    const onProgress = vi.fn()
    const result = await createLoopSuggester().run(input, graph, onProgress)

    expect(result).toEqual(ROUTED_SUGGESTIONS)
    expect(onProgress).toHaveBeenCalled()
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2, phase: 'route' })
  })

  it('cancel() mid-run resolves with [] and leaves no pending timer', async () => {
    searchRoutedLoopsMock.mockImplementation(function* (): Generator<
      LoopSearchProgress,
      RoutedSuggestion[]
    > {
      while (true) yield { done: 0, total: 1, phase: 'search' }
    })

    vi.useFakeTimers()
    const suggester = createLoopSuggester()
    const promise = suggester.run(input, graph, () => {})

    expect(vi.getTimerCount()).toBe(1)

    suggester.cancel()
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a fresh run after cancel() starts clean', async () => {
    searchRoutedLoopsMock.mockImplementation(function* (): Generator<
      LoopSearchProgress,
      RoutedSuggestion[]
    > {
      yield { done: 1, total: 1, phase: 'route' }
      return ROUTED_SUGGESTIONS
    })
    const suggester = createLoopSuggester()
    suggester.cancel()
    await expect(suggester.run(input, graph, () => {})).resolves.toEqual(ROUTED_SUGGESTIONS)
  })
})
