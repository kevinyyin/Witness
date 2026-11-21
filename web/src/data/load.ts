import type { Incident, IncidentIndex, IndexEntry, OsmFile, OsmIndexEntry } from '../types'

const BASE = import.meta.env.BASE_URL

/** GET a static JSON file. Returns null on 404, network error, or a non-JSON body
 *  (the Vite dev server answers missing files with index.html). */
export async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(BASE + path, { cache: 'no-store' })
    if (!r.ok) return null
    if (!(r.headers.get('content-type') ?? '').includes('json')) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

/** Accepts `{incidents:[…], run?}` or a bare array (PLAN gap 9). */
export function normalizeIndex(raw: unknown, fromSample: boolean): IncidentIndex | null {
  if (Array.isArray(raw)) return { incidents: raw as IndexEntry[], is_sample: fromSample }
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).incidents)) {
    const r = raw as any
    return { incidents: r.incidents, run: r.run, is_sample: fromSample || r.is_sample === true }
  }
  return null
}

/** incidents/index.json (teammate) → fallback sample_index.json (mine, banner). */
export async function loadIndex(): Promise<IncidentIndex> {
  const real = normalizeIndex(await getJSON('incidents/index.json'), false)
  if (real && real.incidents.length) return real
  const sample = normalizeIndex(await getJSON('sample_index.json'), true)
  return sample ?? { incidents: [], is_sample: true }
}

/** id "sample" → sample_incident.json; anything else → incidents/<id>.json. */
export async function loadIncident(id: string): Promise<Incident | null> {
  if (id === 'sample') return getJSON<Incident>('sample_incident.json')
  return getJSON<Incident>(`incidents/${encodeURIComponent(id)}.json`)
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.PI / 180
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k)
  const y = (b.lat - a.lat) * k
  return Math.hypot(x, y) * 6371000
}

export type OsmPick = { entry: OsmIndexEntry; osm: OsmFile; distance_m: number; inside: boolean }

/** Nearest OSM extract (by center) to the impact. `inside` = impact within its radius. */
export async function loadOsmFor(impact: { lat: number; lon: number }): Promise<OsmPick | null> {
  const index = await getJSON<OsmIndexEntry[]>('osm/index.json')
  if (!index || !index.length) return null
  const ranked = index
    .map((entry) => ({ entry, d: distanceM(impact, entry.center) }))
    .sort((a, b) => a.d - b.d)
  const best = ranked[0]
  const osm = await getJSON<OsmFile>(`osm/${best.entry.file}`)
  if (!osm) return null
  return { entry: best.entry, osm, distance_m: best.d, inside: best.d <= best.entry.radius_m }
}
