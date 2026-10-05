import { describe, it, expect, vi } from 'vitest'
import { loadCircuits, validateCircuits } from '../circuits'
import type { Circuit } from '../circuits'
import { RACETRACK_CLASSES } from './wikidata'
import { applyExtraction, extractCircuit, formatCircuits, provenanceRow } from './extract'
import type { ExtractDeps, ExtractOptions, ExtractResult } from './extract'
import type { JsonRequest } from './http'
import entitiesFixture from './fixtures/wikidata-entities.json'
import overpassMonza from './fixtures/overpass-monza.json'
import circuitsFile from '../data/circuits.json?raw'

type Fake = { deps: ExtractDeps; requests: string[]; logs: string[] }

/** Fake Wikidata + Overpass built from the real trimmed fixtures. */
function fake(search: Record<string, string[]> = {}): Fake {
  const requests: string[] = []
  const logs: string[] = []
  const deps: ExtractDeps = {
    today: () => '2026-09-28',
    log: (m) => void logs.push(m),
    getJson: async (req: JsonRequest) => {
      const url = req.urls[0]!
      requests.push(`${url}${req.body ? ` ${decodeURIComponent(req.body)}` : ''}`)
      if (url.includes('list=search')) {
        const [, term, classId] = /srsearch=(.*?)\s?haswbstatement:P31=(Q\d+)/.exec(decodeURIComponent(url))!.slice(0) as [string, string, string]
        const ids = search[term.toLowerCase()] ?? (term.toLowerCase() === 'monza' && classId === 'Q2338524' ? ['Q171417', 'Q24940439'] : [])
        return { query: { search: ids.map((title) => ({ title })) } }
      }
      if (url.includes('wbgetentities')) {
        const ids = decodeURIComponent(/ids=([^&]*)/.exec(url)![1]!).split('|')
        const all = (entitiesFixture as { entities: Record<string, unknown> }).entities
        return { entities: Object.fromEntries(ids.filter((i) => all[i]).map((i) => [i, all[i]])) }
      }
      if (url.includes('overpass')) return overpassMonza
      throw new Error(`unexpected request ${url}`)
    },
  }
  return { deps, requests, logs }
}

// Without Monza: once `extract-circuit` has added it to the bundle, these tests must still extract it afresh.
const existing = loadCircuits().filter((c) => c.id !== 'monza')
const run = (query: string, opts: ExtractOptions = {}, f: Fake = fake()): Promise<ExtractResult> =>
  extractCircuit(query, existing, opts, f.deps)

function extracted(result: ExtractResult) {
  if (result.kind !== 'extracted') throw new Error(`expected an extraction, got ${result.kind}: ${'message' in result ? result.message : ''}`)
  return result
}

describe('extractCircuit — name to a validated circuit (Monza fixtures)', () => {
  it('assembles a circuit that passes the real validateCircuits alongside the bundled ones', async () => {
    const { circuit, provenance } = extracted(await run('Monza'))
    expect(circuit.id).toBe('monza')
    expect(circuit.name).toBe('Monza Circuit')
    expect(circuit.officialLengthM).toBe(5793)
    expect(circuit.location.lat).toBeCloseTo(45.6206, 3)
    expect(circuit.attribution).toEqual({
      source: 'OpenStreetMap contributors',
      license: 'ODbL 1.0',
      url: 'https://www.openstreetmap.org/relation/284565',
      retrieved: '2026-09-28',
    })
    expect(circuit.centreline.length).toBeGreaterThanOrEqual(20)
    expect(circuit.centreline[0]).not.toEqual(circuit.centreline[circuit.centreline.length - 1])
    expect(() => validateCircuits([...existing, circuit])).not.toThrow()
    expect(provenance.wayIds).toHaveLength(20)
    expect(provenance.notes.join(" ")).toMatch(/same lap/)
    expect(Math.abs(provenance.computedLengthM - 5793)).toBeLessThan(40)
  })

  it('searches each racetrack class by name, and only ever asks Wikidata and a bounded Overpass query', async () => {
    const f = fake()
    await run('Monza', {}, f)
    const searches = f.requests.filter((r) => r.includes('list=search')).map((r) => decodeURIComponent(r))
    expect(searches).toHaveLength(RACETRACK_CLASSES.size)
    for (const classId of RACETRACK_CLASSES) expect(searches.some((s) => s.includes(`Monza haswbstatement:P31=${classId}`))).toBe(true)
    const overpass = f.requests.filter((r) => r.includes('overpass'))
    expect(overpass).toHaveLength(1)
    expect(overpass[0]).not.toMatch(/name\s*~/)
    expect(overpass[0]).toContain('"wikidata"="Q171417"')
  })

  it('derives the id from the name, and --id / --name override', async () => {
    const { circuit } = extracted(await run('Monza', { id: 'monza-gp', name: 'Autodromo Nazionale Monza' }))
    expect(circuit.id).toBe('monza-gp')
    expect(circuit.name).toBe('Autodromo Nazionale Monza')
  })

  it('uses a supplied --wikidata, skipping the name search', async () => {
    const f = fake()
    extracted(await run('anything', { wikidata: 'Q171417' }, f))
    expect(f.requests.some((r) => r.includes('list=search'))).toBe(false)
  })

  it('needs no Wikidata at all when the source, coordinate and length are supplied', async () => {
    const f = fake()
    const { circuit } = extracted(
      await run('Monza by hand', { relation: 284565, lat: 45.6206, lon: 9.2894, officialLengthM: 5793 }, f),
    )
    expect(f.requests.some((r) => r.includes('wikidata.org'))).toBe(false)
    expect(f.requests.some((r) => r.includes('rel(284565)'))).toBe(true)
    expect(circuit.attribution.url).toBe('https://www.openstreetmap.org/relation/284565')
  })

  it('--list reports candidates and assembles nothing', async () => {
    const f = fake()
    expect((await run('Monza', { list: true }, f)).kind).toBe('listed')
    expect(f.logs.join('\n')).toMatch(/closed ring/)
  })
})

describe('extractCircuit — relation auto-discovery fallback (street circuits)', () => {
  const RELATION_LOOKUP = 'relation["wikidata"="Q171417"]'
  const RELATION_WAYS = 'rel(284565)->.rels;'

  // A real `buildElementQuery({relation: 284565})` fetch returns only that
  // relation's own 21 member ways — not the 30 other nearby raceway ways
  // (Monza's banked oval, alternate layouts) the bundled fixture's broader
  // near-point query also pulled in. Filtering here, once, keeps the fake
  // faithful to that scoped shape without a second fixture file to maintain.
  const monzaRelationOnly = (() => {
    const els = (overpassMonza as { elements: Array<Record<string, unknown>> }).elements
    const rel = els.find((e) => e['type'] === 'relation')!
    const memberWayIds = new Set(
      (rel['members'] as Array<{ type: string; ref: number }>).filter((m) => m.type === 'way').map((m) => m.ref),
    )
    const ways = els.filter((e) => e['type'] === 'way' && memberWayIds.has(e['id'] as number))
    const nodeIds = new Set(ways.flatMap((w) => w['nodes'] as number[]))
    const nodes = els.filter((e) => e['type'] === 'node' && nodeIds.has(e['id'] as number))
    return { elements: [rel, ...ways, ...nodes] }
  })()

  /** Point-radius search finds nothing (as for a real street circuit with no
   *  highway=raceway nearby); the circuit's own OSM relation (284565, real
   *  Monza fixture data) is only reachable via the wikidata-tag lookup. */
  function fakeNoNearbyRaceway(): Fake {
    const requests: string[] = []
    const logs: string[] = []
    const deps: ExtractDeps = {
      today: () => '2026-09-28',
      log: (m) => void logs.push(m),
      getJson: async (req: JsonRequest) => {
        const url = req.urls[0]!
        const body = req.body ? decodeURIComponent(req.body) : ''
        requests.push(`${url}${body ? ` ${body}` : ''}`)
        if (url.includes('wbgetentities')) {
          const ids = decodeURIComponent(/ids=([^&]*)/.exec(url)![1]!).split('|')
          const all = (entitiesFixture as { entities: Record<string, unknown> }).entities
          return { entities: Object.fromEntries(ids.filter((i) => all[i]).map((i) => [i, all[i]])) }
        }
        if (url.includes('overpass')) {
          if (body.includes(RELATION_LOOKUP)) {
            return { elements: [{ type: 'relation', id: 284565, tags: { name: 'Autodromo Nazionale di Monza', wikidata: 'Q171417' } }] }
          }
          if (body.includes(RELATION_WAYS)) return monzaRelationOnly
          return { elements: [] } // the initial point-radius search
        }
        throw new Error(`unexpected request ${url}`)
      },
    }
    return { deps, requests, logs }
  }

  it('auto-discovers the circuit’s own wikidata-tagged relation and extracts from it', async () => {
    const f = fakeNoNearbyRaceway()
    const { circuit, provenance } = extracted(await run('Monza', { wikidata: 'Q171417' }, f))
    expect(circuit.id).toBe('monza')
    expect(circuit.officialLengthM).toBe(5793)
    expect(provenance.notes.join(' ')).toMatch(/auto-discovered via its own OSM relation 284565 \(wikidata=Q171417\)/)
    expect(f.logs.join('\n')).toMatch(/found OSM relation 284565 tagged wikidata=Q171417/)
  })

  it('falls through to the normal refusal, noting the relation path was tried, when no relation matches either', async () => {
    const f = fakeNoNearbyRaceway()
    const deps: ExtractDeps = {
      ...f.deps,
      getJson: async (req) => {
        const body = req.body ? decodeURIComponent(req.body) : ''
        if (req.urls[0]!.includes('overpass') && body.includes(RELATION_LOOKUP)) return { elements: [] }
        return f.deps.getJson(req)
      },
    }
    const result = await run('Monza', { wikidata: 'Q171417' }, { ...f, deps })
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('no-ring')
      expect(result.message).toMatch(/no OSM relation of its own worked either/)
    }
  })

  it('never overrides an explicit --relation, even when that relation’s own ways find nothing', async () => {
    const f = fakeNoNearbyRaceway()
    const deps: ExtractDeps = {
      ...f.deps,
      getJson: async (req) => {
        const body = req.body ? decodeURIComponent(req.body) : ''
        if (req.urls[0]!.includes('overpass') && body.includes('rel(999)->.rels;')) return { elements: [] }
        return f.deps.getJson(req)
      },
    }
    const result = await run('Monza', { wikidata: 'Q171417', relation: 999 }, { ...f, deps })
    expect(result.kind).toBe('refused')
    // The auto-discovery lookup (and its "tried the relation" hint) must never fire for an explicit --relation.
    expect(f.requests.some((r) => r.includes(RELATION_LOOKUP))).toBe(false)
    if (result.kind === 'refused') expect(result.message).not.toMatch(/auto-discovered|OSM relation of its own/)
  })
})

describe('extractCircuit — refusals (never a guess)', () => {
  it('refuses when Wikidata has no such racetrack, saying what to pass instead', async () => {
    const result = await run('Nowhereville')
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('no-entity')
      expect(result.message).toMatch(/--wikidata/)
    }
  })

  it('refuses when a name matches several racetracks, listing them with their lengths', async () => {
    const result = await run('circuit', {}, fake({ circuit: ['Q171417', 'Q172851'] }))
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('ambiguous-entity')
      expect(result.message).toMatch(/Q171417[\s\S]*5793[\s\S]*Q172851[\s\S]*7003/)
    }
  })

  it('refuses when no ring is near the official length, and shows how far off the closest is', async () => {
    const result = await run('Monza', { officialLengthM: 20000, lat: 45.6206, lon: 9.2894 })
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('no-ring')
      expect(result.message).toMatch(/% off the official length/)
      expect(result.message).toMatch(/street circuit/) // 56% off: hint that the lap may not be tagged as raceway
    }
  })

  it('refuses to guess when several combinations of layouts are equally close (a length that suits the union rings)', async () => {
    // ~8.7 km matches several Grand Prix + banked-oval combinations at once.
    const result = await run('Monza', { officialLengthM: 9000, lat: 45.6206, lon: 9.2894 })
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('ambiguous-ring')
      expect(result.message).toMatch(/refusing to guess[\s\S]*m \(\d+\.\d% off 9000 m\)/)
    }
  })

  it('--pick N extracts the Nth candidate from an otherwise-ambiguous refusal instead of refusing', async () => {
    const result = await run('Monza', { officialLengthM: 9000, lat: 45.6206, lon: 9.2894, pick: 1 })
    const { circuit, provenance } = extracted(result)
    expect(circuit.officialLengthM).toBe(9000)
    expect(provenance.notes.join(' ')).toMatch(/manually pinned via --pick 1/)
  })

  it('--pick out of range still refuses, naming how many candidates were listed', async () => {
    const result = await run('Monza', { officialLengthM: 9000, lat: 45.6206, lon: 9.2894, pick: 99 })
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('ambiguous-ring')
      expect(result.message).toMatch(/--pick 99 is out of range/)
    }
  })

  it('refuses, instead of throwing, when the way graph has too many candidate laps — and says why', async () => {
    // A ladder of many rungs has C(n, 2) simple cycles (every pair of rungs
    // closes one) — real shape of the Circuit of the Americas failure this
    // guards: a dense mesh of legitimate alternate pairings, not a crash.
    const elements: unknown[] = []
    let nodeId = 1
    const nodeIdAt = new Map<string, number>()
    const nodeAt = (key: string, lon: number, lat: number): number => {
      let id = nodeIdAt.get(key)
      if (id === undefined) {
        id = nodeId++
        nodeIdAt.set(key, id)
        elements.push({ type: 'node', id, lon, lat })
      }
      return id
    }
    let wayId = 1
    const rungs = 101 // C(101, 2) = 5050 > MAX_CYCLES (5000)
    for (let i = 0; i < rungs; i++) {
      elements.push({ type: 'way', id: wayId++, nodes: [nodeAt(`t${i}`, i * 0.001, 45), nodeAt(`b${i}`, i * 0.001, 44.999)], tags: { highway: 'raceway' } })
      if (i > 0) {
        elements.push({ type: 'way', id: wayId++, nodes: [nodeAt(`t${i - 1}`, (i - 1) * 0.001, 45), nodeAt(`t${i}`, i * 0.001, 45)], tags: { highway: 'raceway' } })
        elements.push({ type: 'way', id: wayId++, nodes: [nodeAt(`b${i - 1}`, (i - 1) * 0.001, 44.999), nodeAt(`b${i}`, i * 0.001, 44.999)], tags: { highway: 'raceway' } })
      }
    }
    const f = fake()
    const tangled: ExtractDeps = { ...f.deps, getJson: async (req) => (req.urls[0]!.includes('overpass') ? { elements } : f.deps.getJson(req)) }
    const result = await run('Monza', {}, { ...f, deps: tangled })
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') {
      expect(result.code).toBe('too-tangled')
      expect(result.message).toMatch(/too tangled to search|too many candidate laps/)
      expect(result.message).toMatch(/Most likely culprit/)
      expect(result.message).toMatch(/--exclude-ways \d+/)
    }
  }, 20_000)

  it('throws before anything is written when the id already exists', async () => {
    const taken: Circuit[] = [...existing, { ...existing[0]!, id: 'monza' }]
    await expect(extractCircuit('Monza', taken, {}, fake().deps)).rejects.toThrow(/duplicate circuit id: monza/)
  })
})

describe('applyExtraction — the only writer', () => {
  it('writes once, with a file that loads back and contains the new circuit', async () => {
    const write = vi.fn()
    const result = await run('Monza')
    const next = applyExtraction(existing, result, write)
    expect(write).toHaveBeenCalledTimes(1)
    expect(next.map((c) => c.id)).toEqual([...existing.map((c) => c.id), 'monza'])
    const reloaded = validateCircuits(JSON.parse(write.mock.calls[0]![0] as string))
    expect(reloaded).toEqual(next)
  })

  it('never calls write for a refusal, so circuits.json is left as it was', async () => {
    const write = vi.fn()
    const result = await run('Nowhereville')
    expect(applyExtraction(existing, result, write)).toEqual(existing)
    expect(write).not.toHaveBeenCalled()
  })

  it('replaces an existing circuit of the same id (the --refresh path) instead of duplicating it', async () => {
    const write = vi.fn()
    const result = await run('Monza')
    const withOld: Circuit[] = [...existing, { ...(extracted(result).circuit), name: 'Old Monza' }]
    const next = applyExtraction(withOld, result, write)
    expect(next.filter((c) => c.id === 'monza')).toHaveLength(1)
    expect(next.find((c) => c.id === 'monza')!.name).toBe('Monza Circuit')
  })

  it('does not write when the resulting list fails validation', async () => {
    const write = vi.fn()
    const good = extracted(await run('Monza'))
    const broken: ExtractResult = { ...good, circuit: { ...good.circuit, officialLengthM: 100 } }
    expect(() => applyExtraction(existing, broken, write)).toThrow(/not within/)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('formatCircuits', () => {
  it('reproduces the bundled circuits.json byte for byte', () => {
    expect(formatCircuits(loadCircuits())).toBe(circuitsFile)
  })
})

describe('provenanceRow', () => {
  it('renders the row for circuits.schema.md, with the way ids for a multi-way ring', async () => {
    const { circuit, provenance } = extracted(await run('Monza'))
    const row = provenanceRow(circuit, provenance)
    expect(row).toMatch(/^\| `monza` \| Monza Circuit \| \[relation 284565\]\(https:\/\/www\.openstreetmap\.org\/relation\/284565\)/)
    expect(row).toMatch(/\| \d+ m \/ 5793 m \|$/)
  })
})
