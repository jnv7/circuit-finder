// Cooperative driver for the Phase 6 search. `searchPlacements` is a synchronous
// generator; this pumps it in short bursts, yielding a macrotask to the event
// loop between them, so the panel can paint a progress bar and Cancel responds.
// No Web Worker (keeps the build a plain static bundle); if the slices ever feel
// janky a worker drops in behind this same interface.
import { searchPlacements } from '../match/search'
import type { SearchInput, SearchOptions, SearchProgress, Suggestion } from '../match/types'

/** Wall-clock budget per burst, milliseconds. */
export const SLICE_MS = 12
/** Hard cap on generator steps per burst — a fallback so a burst still ends and
 *  yields even if the clock does not advance (e.g. under faked timers). */
const MAX_STEPS_PER_SLICE = 20000

export type Suggester = {
  run(
    input: SearchInput,
    onProgress: (p: SearchProgress) => void,
    opts?: SearchOptions,
  ): Promise<Suggestion[]>
  cancel(): void
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export function createSuggester(): Suggester {
  let cancelled = false

  return {
    cancel(): void {
      cancelled = true
    },

    async run(input, onProgress, opts): Promise<Suggestion[]> {
      cancelled = false
      const gen = searchPlacements(input, opts)
      let step = gen.next()

      while (!step.done) {
        if (cancelled) {
          gen.return([])
          return []
        }
        const until = performance.now() + SLICE_MS
        let steps = 0
        while (!step.done && steps < MAX_STEPS_PER_SLICE && performance.now() < until) {
          onProgress(step.value)
          step = gen.next()
          steps++
          if (cancelled) break
        }
        if (step.done) break
        if (cancelled) {
          gen.return([])
          return []
        }
        await macrotask()
      }

      if (cancelled) {
        gen.return([])
        return []
      }
      return step.value
    },
  }
}
