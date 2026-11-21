// Pure geometry from OSM footprints (no three.js here, so it is testable in node).
import type { OsmFile } from '../types'
import { toLocal, type LatLon } from './geo'

export const FLOOR_M = 3 // §7.1.3: height = building:levels × 3 m
export const DEFAULT_LEVELS = 5 // §7.1.3 default

type Poly = { pts: [number, number][]; h: number; target: boolean }

function polygons(osm: OsmFile, origin: LatLon, targetId?: string): Poly[] {
  const out: Poly[] = []
  for (const e of osm.elements) {
    if (!e.geometry) continue
    const pts = e.geometry.map((p) => toLocal(origin, p.lat, p.lon))
    const [a, b] = [pts[0], pts[pts.length - 1]]
    if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop() // drop the closing point
    if (pts.length < 3) continue
    const levels = parseFloat(e.tags?.['building:levels'] ?? '')
    out.push({ pts, h: (levels > 0 ? levels : DEFAULT_LEVELS) * FLOOR_M, target: `way/${e.id}` === targetId })
  }
  return out
}

const area = (p: [number, number][]) =>
  Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z }, 0)) / 2
const perimeter = (p: [number, number][]) =>
  p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + Math.hypot(x2 - x, z2 - z) }, 0)

function inside(x: number, z: number, p: [number, number][]): boolean {
  let hit = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

export type Cloud = { positions: Float32Array; target: Float32Array; count: number; step: number }

/** LiDAR-style points on walls + roofs. Spacing adapts so the total stays near `budget` (§7.1.2: 200–500k). */
export function sampleCity(osm: OsmFile, origin: LatLon, targetId?: string, budget = 450_000): Cloud {
  const polys = polygons(osm, origin, targetId)
  const total = polys.reduce((s, p) => s + perimeter(p.pts) * p.h + area(p.pts), 0)
  const step = Math.max(1, Math.sqrt(total / budget)) // ~1 point per step² m²
  const pos: number[] = [], tgt: number[] = []
  const jit = () => (Math.random() - 0.5) * step * 0.4 // breaks up grid moiré
  const add = (x: number, y: number, z: number, t: number) => { pos.push(x + jit(), y + jit(), z + jit()); tgt.push(t) }

  for (const p of polys) {
    const t = p.target ? 1 : 0, n = p.pts.length
    for (let i = 0; i < n; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[(i + 1) % n]
      const m = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step))
      for (let k = 0; k < m; k++) {
        const f = (k + 0.5) / m
        for (let y = step / 2; y < p.h; y += step) add(ax + (bx - ax) * f, y, az + (bz - az) * f, t)
      }
    }
    const xs = p.pts.map((q) => q[0]), zs = p.pts.map((q) => q[1])
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step)
        if (inside(x, z, p.pts)) add(x, p.h, z, t)
  }
  return { positions: Float32Array.from(pos), target: Float32Array.from(tgt), count: tgt.length, step }
}

/** Wireframe fallback (§7.1.2): footprint at ground and roof + vertical corners, as line-segment pairs. */
export function wireCity(osm: OsmFile, origin: LatLon, targetId?: string): Omit<Cloud, 'step'> {
  const pos: number[] = [], tgt: number[] = []
  const seg = (a: number[], b: number[], t: number) => { pos.push(...a, ...b); tgt.push(t, t) }
  for (const p of polygons(osm, origin, targetId)) {
    const t = p.target ? 1 : 0, n = p.pts.length
    for (let i = 0; i < n; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[(i + 1) % n]
      seg([ax, 0, az], [bx, 0, bz], t)
      seg([ax, p.h, az], [bx, p.h, bz], t)
      seg([ax, 0, az], [ax, p.h, az], t)
    }
  }
  return { positions: Float32Array.from(pos), target: Float32Array.from(tgt), count: tgt.length / 2 }
}

/** Sparse ground grid inside a circle (§7.1.2). */
export function groundGrid(radius: number, spacing: number): Float32Array {
  const pos: number[] = []
  for (let x = -radius; x <= radius; x += spacing)
    for (let z = -radius; z <= radius; z += spacing)
      if (x * x + z * z <= radius * radius) pos.push(x, 0, z)
  return Float32Array.from(pos)
}
