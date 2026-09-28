// Circuit-name handling for `find-route` (Phase 24): normalise a name so
// "Autódromo" and "autodromo" compare equal, match it against the bundled
// circuits, and derive a stable id slug.
import type { Circuit } from '../circuits'

/** Words that carry no identity in a circuit name and are left out of ids. */
const SLUG_STOP_WORDS = new Set(['circuit', 'de', 'du', 'di', 'del', 'of', 'the'])

/** NFD-strip accents, case-fold, drop punctuation, collapse whitespace. */
export function normaliseName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Bundled circuits a query refers to: 0, 1 or several. An exact match on the
 * normalised id or name wins outright; otherwise every circuit whose name
 * contains all of the query's words does ("Silverstone" → "Silverstone Circuit").
 */
export function matchBundled(query: string, circuits: readonly Circuit[]): Circuit[] {
  const q = normaliseName(query)
  if (q === '') return []
  const exact = circuits.filter((c) => normaliseName(c.id) === q || normaliseName(c.name) === q)
  if (exact.length > 0) return exact
  const words = q.split(' ')
  return circuits.filter((c) => {
    const have = new Set(`${normaliseName(c.id)} ${normaliseName(c.name)}`.split(' '))
    return words.every((w) => have.has(w))
  })
}

/** A URL-safe id from a display name: "Monza Circuit" → "monza". */
export function slugId(name: string): string {
  const words = normaliseName(name).split(' ').filter((w) => w !== '')
  const meaningful = words.filter((w) => !SLUG_STOP_WORDS.has(w))
  return (meaningful.length > 0 ? meaningful : words).join('-')
}
