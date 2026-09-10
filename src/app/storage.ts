// The one `localStorage` key that holds every saved placement, and the thin
// read/write glue around it. All parsing/validation is pure and lives in
// `src/placements.ts`; this file only touches `localStorage` and degrades
// gracefully when it is unavailable (private mode, disabled, over quota) so the
// session stays usable, just non-persistent.
import type { PlacementStore, SavedPlacement } from '../placements'
import { parseStoredPlacements, serialisePlacements } from '../placements'

export const STORAGE_KEY = 'circuit-finder/placements'

/** Every saved placement, keyed by circuit id. `{}` on any read failure. */
export function loadPlacements(): Record<string, SavedPlacement> {
  try {
    return parseStoredPlacements(localStorage.getItem(STORAGE_KEY))
  } catch (err) {
    console.warn(`storage: cannot read ${STORAGE_KEY}: ${(err as Error).message}`)
    return {}
  }
}

/** Persist the whole store. Quota / access errors are logged, not thrown. */
export function savePlacements(store: PlacementStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialisePlacements(store))
  } catch (err) {
    console.warn(`storage: cannot write ${STORAGE_KEY}: ${(err as Error).message}`)
  }
}
