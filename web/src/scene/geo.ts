export type LatLon = { lat: number; lon: number }

const M_PER_DEG = 111320

/** Local metres around `o`: x east, z south (three.js convention: north is -z). */
export function toLocal(o: LatLon, lat: number, lon: number): [number, number] {
  return [(lon - o.lon) * M_PER_DEG * Math.cos((o.lat * Math.PI) / 180), (o.lat - lat) * M_PER_DEG]
}
