// Bookmarkable state for the routes page: `#hungaroring/2` = circuit id and
// route rank. Pure. Whether the circuit or rank actually exists is the page's
// business (it falls back gracefully), not the parser's.
export type RouteRef = { circuitId: string; rank: number }

const HASH_RE = /^#?([A-Za-z0-9][A-Za-z0-9_-]*)\/([1-9]\d*)$/

export function parseHash(hash: string): RouteRef | null {
  const match = HASH_RE.exec(hash)
  if (!match) return null
  const rank = Number(match[2])
  if (!Number.isSafeInteger(rank)) return null
  return { circuitId: match[1]!, rank }
}

export function formatHash(ref: RouteRef): string {
  return `#${ref.circuitId}/${ref.rank}`
}
