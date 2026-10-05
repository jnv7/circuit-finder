// Bookmarkable state for the routes page: `#hungaroring/espinho/2` = circuit
// id, region id, and route rank *within that region* (Phase 26: rank alone is
// no longer unique once every region has its own rank 1). Pure. Whether the
// circuit, region, or rank actually exist is the page's business (it falls
// back gracefully), not the parser's.
export type RouteRef = { circuitId: string; region: string; rank: number }

const HASH_RE = /^#?([A-Za-z0-9][A-Za-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)\/([1-9]\d*)$/

export function parseHash(hash: string): RouteRef | null {
  const match = HASH_RE.exec(hash)
  if (!match) return null
  const rank = Number(match[3])
  if (!Number.isSafeInteger(rank)) return null
  return { circuitId: match[1]!, region: match[2]!, rank }
}

export function formatHash(ref: RouteRef): string {
  return `#${ref.circuitId}/${ref.region}/${ref.rank}`
}

/** A link to just a circuit, no region/rank — what the home page's circuit
 *  cards use (they don't know which route is best): `#monza`. The routes
 *  page resolves it to that circuit's best route among the checked regions. */
export type CircuitRef = { circuitId: string }

const CIRCUIT_HASH_RE = /^#?([A-Za-z0-9][A-Za-z0-9_-]*)$/

export function parseCircuitHash(hash: string): CircuitRef | null {
  const match = CIRCUIT_HASH_RE.exec(hash)
  if (!match) return null
  return { circuitId: match[1]! }
}

export function formatCircuitHash(ref: CircuitRef): string {
  return `#${ref.circuitId}`
}
