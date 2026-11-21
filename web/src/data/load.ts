import type { Incident, IncidentIndex, OsmFile } from '../types'

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

/** §9.3: incidents/index.json (pipeline) → if missing, sample_index.json (same shape, is_sample: true). */
export async function loadIndex(): Promise<IncidentIndex | null> {
  const real = await getJSON<IncidentIndex>('incidents/index.json')
  if (real && Array.isArray(real.incidents)) return real
  return getJSON<IncidentIndex>('sample_index.json')
}

/** id "sample" (the one entry in sample_index.json) → sample_incident.json; anything else → incidents/<id>.json. */
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

export type OsmPick = { file: string; osm: OsmFile; distance_m: number | null; inside: boolean }

/** The building file named in `osm_file` (§9.2). `inside` = impact within the extract's radius (a warning, not an error). */
export async function loadOsm(inc: Incident): Promise<OsmPick | null> {
  const osm = await getJSON<OsmFile>(inc.osm_file)
  if (!osm) return null
  const c = osm.center
  const d = c ? distanceM(inc.impact, { lat: c[0], lon: c[1] }) : null
  return { file: inc.osm_file, osm, distance_m: d, inside: d == null || d <= (osm.radius_m ?? Infinity) }
}
