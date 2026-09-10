// Data attribution shared by every bundled dataset (circuits, streets). Each
// normalised copy of OpenStreetMap geometry carries its own source/licence
// string, shown on the map.

export type Attribution = {
  source: string
  license: string
  url: string
  retrieved: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Validate an `attribution` object: non-empty string `source`, `license`,
 * `url`, `retrieved`. Throws with a descriptive message on the first problem.
 */
export function validateAttribution(value: unknown, where: string): Attribution {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where} must have an attribution object`)
  }
  const record = value as Record<string, unknown>
  for (const key of ['source', 'license', 'url', 'retrieved'] as const) {
    if (!isNonEmptyString(record[key])) {
      throw new Error(`${where} attribution.${key} must be a non-empty string`)
    }
  }
  return {
    source: record['source'] as string,
    license: record['license'] as string,
    url: record['url'] as string,
    retrieved: record['retrieved'] as string,
  }
}
