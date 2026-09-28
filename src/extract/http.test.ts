import { describe, it, expect } from 'vitest'
import { MIN_REQUEST_GAP_S, RETRY_BACKOFF_S, createJsonClient, hashKey } from './http'
import type { HttpDeps, HttpResponse } from './http'

type Scripted = { status: number; body: string } | Error

function harness(script: Scripted[], opts: { offline?: boolean; cached?: Record<string, string> } = {}) {
  let clock = 1_000_000
  const sleeps: number[] = []
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string; at: number }> = []
  const store = new Map<string, string>(Object.entries(opts.cached ?? {}))
  let i = 0
  const deps: HttpDeps = {
    userAgent: 'circuit-finder-test/1 (test@example.com)',
    offline: opts.offline ?? false,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }), at: clock })
      const next = script[Math.min(i++, script.length - 1)]!
      if (next instanceof Error) throw next
      const res: HttpResponse = { status: next.status, text: async () => next.body }
      return res
    },
    cache: { get: (k) => store.get(k), put: (k, v) => void store.set(k, v) },
  }
  return { client: createJsonClient(deps), sleeps, calls, store }
}

const ok = (json: unknown): Scripted => ({ status: 200, body: JSON.stringify(json) })
const status = (code: number, body = ''): Scripted => ({ status: code, body })
const PRIMARY = 'https://primary.example/api'
const MIRROR = 'https://mirror.example/api'

describe('createJsonClient', () => {
  it('sends a User-Agent and returns parsed JSON', async () => {
    const h = harness([ok({ a: 1 })])
    expect(await h.client({ urls: [PRIMARY] })).toEqual({ a: 1 })
    expect(h.calls[0]!.headers['User-Agent']).toMatch(/circuit-finder-test/)
    expect(h.calls[0]!.method).toBe('GET')
  })

  it('POSTs a form body when one is given', async () => {
    const h = harness([ok({})])
    await h.client({ urls: [PRIMARY], body: 'data=x' })
    expect(h.calls[0]!.method).toBe('POST')
    expect(h.calls[0]!.body).toBe('data=x')
    expect(h.calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it.each([
    ['a 504', status(504)],
    ['a 429', status(429)],
    ['an empty body', status(200, '')],
    ['a non-JSON body', status(200, '<html>busy</html>')],
    ['an Overpass runtime error', ok({ remark: 'runtime error: Query timed out in "query" at line 3', elements: [] })],
    ['a network error', new Error('ECONNRESET')],
  ])('retries after %s, waiting the configured backoff, then succeeds', async (_name, failure) => {
    const h = harness([failure, failure, ok({ done: true })])
    expect(await h.client({ urls: [PRIMARY] })).toEqual({ done: true })
    expect(h.calls).toHaveLength(3)
    expect(h.sleeps.filter((s) => s >= 2000)).toEqual([RETRY_BACKOFF_S[0]! * 1000, RETRY_BACKOFF_S[1]! * 1000])
  })

  it('tries the fallback endpoint once the primary is exhausted, then reports every attempt', async () => {
    const h = harness([status(504)])
    await expect(h.client({ urls: [PRIMARY, MIRROR] })).rejects.toThrow(/all attempts failed[\s\S]*primary\.example[\s\S]*mirror\.example/)
    expect(h.calls.filter((c) => c.url === PRIMARY)).toHaveLength(1 + RETRY_BACKOFF_S.length)
    expect(h.calls.filter((c) => c.url === MIRROR)).toHaveLength(1)
    expect(h.sleeps.filter((s) => s >= 2000)).toEqual(RETRY_BACKOFF_S.map((s) => s * 1000))
  })

  it('succeeds through the fallback when only the primary is down', async () => {
    const h = harness([status(504), status(504), status(504), status(504), status(504), ok({ from: 'mirror' })])
    expect(await h.client({ urls: [PRIMARY, MIRROR] })).toEqual({ from: 'mirror' })
    expect(h.calls[h.calls.length - 1]!.url).toBe(MIRROR)
  })

  it('does not retry a client error such as 400 or 406', async () => {
    const h = harness([status(406, 'no user agent')])
    await expect(h.client({ urls: [PRIMARY, MIRROR] })).rejects.toThrow(/not retryable.*406/)
    expect(h.calls).toHaveLength(1)
  })

  it('leaves at least the politeness gap between two requests', async () => {
    const h = harness([ok(1), ok(2)])
    await h.client({ urls: [PRIMARY + '/a'] })
    await h.client({ urls: [PRIMARY + '/b'] })
    expect(h.calls[1]!.at - h.calls[0]!.at).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_S * 1000)
  })

  it('answers a repeat request from the cache without touching the network', async () => {
    const h = harness([ok({ n: 1 }), ok({ n: 2 })])
    const first = await h.client({ urls: [PRIMARY], body: 'q' })
    const second = await h.client({ urls: [PRIMARY], body: 'q' })
    expect(second).toEqual(first)
    expect(h.calls).toHaveLength(1)
  })

  it('keys the cache on the request, and not on the fallback endpoint', async () => {
    const h = harness([ok({ n: 1 }), ok({ n: 2 }), ok({ n: 3 })])
    await h.client({ urls: [PRIMARY], body: 'q1' })
    await h.client({ urls: [PRIMARY], body: 'q2' })
    expect(h.calls).toHaveLength(2)
    await h.client({ urls: [PRIMARY, MIRROR], body: 'q1' })
    expect(h.calls).toHaveLength(2)
  })

  it('does not cache a failure', async () => {
    const h = harness([status(400, 'bad')])
    await expect(h.client({ urls: [PRIMARY] })).rejects.toThrow()
    expect(h.store.size).toBe(0)
  })

  it('offline: serves the cache, and fails on a miss without calling', async () => {
    const key = hashKey(`GET ${PRIMARY}\n`)
    const hit = harness([ok('never')], { offline: true, cached: { [key]: '{"cached":true}' } })
    expect(await hit.client({ urls: [PRIMARY] })).toEqual({ cached: true })
    expect(hit.calls).toHaveLength(0)

    const miss = harness([ok('never')], { offline: true })
    await expect(miss.client({ urls: [PRIMARY + '/other'] })).rejects.toThrow(/offline/)
    expect(miss.calls).toHaveLength(0)
  })
})

describe('hashKey', () => {
  it('is stable and distinguishes inputs', () => {
    expect(hashKey('a')).toBe(hashKey('a'))
    expect(hashKey('a')).not.toBe(hashKey('b'))
    expect(hashKey('GET x\n')).toMatch(/^[0-9a-f]{14}$/)
  })
})
