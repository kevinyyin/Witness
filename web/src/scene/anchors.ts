// §9.2 anchors → scene points. Unknown camera or building → null: never invent a position.
import * as THREE from 'three'
import type { Anchor, Incident, OsmFile } from '../types'
import { toLocal } from './geo'
import { DEFAULT_LEVELS, FLOOR_M } from './pointcloud'

export type Resolved = THREE.Vector3[] | 'clock' | null

function roofCentre(ring: [number, number][], levels: number | undefined) {
  const x = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const z = ring.reduce((s, p) => s + p[1], 0) / ring.length
  return new THREE.Vector3(x, (levels && levels > 0 ? levels : DEFAULT_LEVELS) * FLOOR_M, z)
}

export function resolveAnchor(inc: Incident, osm: OsmFile | null, a: Anchor | null | undefined): Resolved {
  if (!a) return null
  const o = inc.impact
  switch (a.kind) {
    case 'clock': return 'clock'
    case 'impact': return [new THREE.Vector3(0, 2, 0)]
    case 'point': {
      const [x, z] = toLocal(o, a.lat, a.lon)
      return [new THREE.Vector3(x, a.alt_m ?? 0, z)]
    }
    case 'camera':
    case 'cameras': {
      const ids = a.kind === 'camera' ? [a.ref] : a.ref
      const pts = ids.flatMap((id) => {
        const c = inc.sources.find((s) => s.id === id)?.camera
        if (!c) return []
        const [x, z] = toLocal(o, c.lat, c.lon)
        return [new THREE.Vector3(x, 2, z)]
      })
      return pts.length ? pts : null
    }
    case 'building': {
      if (inc.target?.osm_id === a.ref && inc.target.footprint.length)
        return [roofCentre(inc.target.footprint.map(([lon, lat]) => toLocal(o, lat, lon)), inc.target.levels)]
      const w = osm?.elements.find((e) => `way/${e.id}` === a.ref)
      if (!w?.geometry?.length) return null
      return [roofCentre(w.geometry.map((p) => toLocal(o, p.lat, p.lon)), parseFloat(w.tags?.['building:levels'] ?? ''))]
    }
    default: return null
  }
}
