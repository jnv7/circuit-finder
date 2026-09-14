// Cooperative driver for the Phase 6 placement search. `searchPlacements` is a
// synchronous generator; this pumps it in short bursts, yielding a macrotask
// to the event loop between them, so the panel can paint a progress bar and
// Cancel responds. No Web Worker (keeps the build a plain static bundle); if
// the slices ever feel janky a worker drops in behind this same interface.
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

/**
 * Pump a synchronous generator in `SLICE_MS` bursts, yielding a macrotask
 * between them, until it completes or `isCancelled()` goes true — in which
 * case the generator is told to `return([])` (so it can clean up) and the
 * driver itself resolves to `[]`.
 */
async function pump<P, R>(
  gen: Generator<P, R[]>,
  onProgress: (p: P) => void,
  isCancelled: () => boolean,
): Promise<R[]> {
  let step = gen.next()

  while (!step.done) {
    if (isCancelled()) {
      gen.return([])
      return []
    }
    const until = performance.now() + SLICE_MS
    let steps = 0
    while (!step.done && steps < MAX_STEPS_PER_SLICE && performance.now() < until) {
      onProgress(step.value)
      step = gen.next()
      steps++
      if (isCancelled()) break
    }
    if (step.done) break
    if (isCancelled()) {
      gen.return([])
      return []
    }
    await macrotask()
  }

  if (isCancelled()) {
    gen.return([])
    return []
  }
  return step.value
}

export function createSuggester(): Suggester {
  let cancelled = false

  return {
    cancel(): void {
      cancelled = true
    },

    async run(input, onProgress, opts): Promise<Suggestion[]> {
      cancelled = false
      return pump(searchPlacements(input, opts), onProgress, () => cancelled)
    },
  }
}
