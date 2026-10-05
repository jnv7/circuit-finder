// Polite, resilient JSON fetching for `extract-circuit` (Phase 24, split
// from `find-route` in Phase 27) and `extract-region` (Phase 26). Everything
// that touches the outside world — fetch, sleeping, the clock, the cache — is
// injected, so the retry/backoff/mirror/cache behaviour is tested offline.
//
// The public Overpass service rejects a request without a User-Agent (406) and
// answers 504 under load, both observed in the 2026-09-21 and 2026-09-28
// probes, so these are requirements, not polish.

/** Politeness gap between two network requests. */
export const MIN_REQUEST_GAP_S = 1
/** Waits before each retry of one endpoint; after the last, the next endpoint is tried. */
export const RETRY_BACKOFF_S: readonly number[] = [2, 4, 8, 16]

export type HttpResponse = { status: number; text(): Promise<string> }

export type HttpDeps = {
  fetch(url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<HttpResponse>
  sleep(ms: number): Promise<void>
  /** Milliseconds, monotonic enough for gap accounting. */
  now(): number
  cache: { get(key: string): string | undefined; put(key: string, value: string): void }
  /** Use the cache only; a miss is an error and nothing is sent. */
  offline?: boolean
  userAgent: string
}

export type JsonRequest = {
  /** Primary endpoint first, fallbacks after. The cache key uses the first only. */
  urls: readonly string[]
  /** POST body (form-encoded) — omit for GET. */
  body?: string
}

/** cyrb53: a small non-cryptographic 53-bit hash, enough to key a local cache. */
export function hashKey(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Statuses worth retrying: rate limiting and server-side trouble. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

/** An Overpass 200 whose body says the query itself ran out of time or memory. */
function isOverpassRuntimeError(json: unknown): boolean {
  const remark = (json as { remark?: unknown } | null)?.remark
  return typeof remark === 'string' && /runtime error|timed out|out of memory/i.test(remark)
}

export function createJsonClient(deps: HttpDeps): (request: JsonRequest) => Promise<unknown> {
  let lastRequestAt = Number.NEGATIVE_INFINITY

  async function attempt(url: string, request: JsonRequest): Promise<{ ok: true; json: unknown; text: string } | { ok: false; retry: boolean; why: string }> {
    const wait = lastRequestAt + MIN_REQUEST_GAP_S * 1000 - deps.now()
    if (wait > 0) await deps.sleep(wait)
    lastRequestAt = deps.now()
    let response: HttpResponse
    try {
      response = await deps.fetch(url, {
        method: request.body === undefined ? 'GET' : 'POST',
        headers: {
          'User-Agent': deps.userAgent,
          Accept: 'application/json',
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
        },
        ...(request.body === undefined ? {} : { body: request.body }),
      })
    } catch (err) {
      return { ok: false, retry: true, why: `network error: ${err instanceof Error ? err.message : String(err)}` }
    }
    if (isRetryable(response.status)) return { ok: false, retry: true, why: `HTTP ${response.status}` }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, retry: false, why: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}` }
    }
    const text = await response.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, retry: true, why: text.trim() === '' ? 'empty body' : 'body is not JSON' }
    }
    if (isOverpassRuntimeError(json)) return { ok: false, retry: true, why: 'Overpass reported a runtime error' }
    return { ok: true, json, text }
  }

  return async function getJson(request: JsonRequest): Promise<unknown> {
    if (request.urls.length === 0) throw new Error('no URL to request')
    const key = hashKey(`${request.body === undefined ? 'GET' : 'POST'} ${request.urls[0]}\n${request.body ?? ''}`)
    const cached = deps.cache.get(key)
    if (cached !== undefined) return JSON.parse(cached)
    if (deps.offline) throw new Error(`offline: no cached response for ${request.urls[0]}${request.body ? ` (${request.body.slice(0, 80)}…)` : ''}`)

    const tried: string[] = []
    for (const [i, url] of request.urls.entries()) {
      // The primary gets the full backoff ladder; a fallback mirror gets one try.
      const backoff = i === 0 ? RETRY_BACKOFF_S : []
      for (let n = 0; n <= backoff.length; n++) {
        const result = await attempt(url, request)
        if (result.ok) {
          deps.cache.put(key, result.text)
          return result.json
        }
        tried.push(`${url}: ${result.why}`)
        if (!result.retry) throw new Error(`request failed and is not retryable — ${result.why}`)
        if (n < backoff.length) await deps.sleep(backoff[n]! * 1000)
      }
    }
    throw new Error(`all attempts failed:\n  ${tried.join('\n  ')}`)
  }
}
