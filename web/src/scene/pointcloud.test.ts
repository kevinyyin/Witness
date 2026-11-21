import { describe, expect, it } from 'vitest'
import { toLocal } from './geo'
import { sampleCity, wireCity } from './pointcloud'
import type { OsmFile } from '../types'

const o = { lat: 50, lon: 36 }
// ~20 m × 20 m square, 2 floors (6 m), closed ring like the Overpass files.
const d = 20 / 111320
const ring = [[0, 0], [0, d * 1.556], [d, d * 1.556], [d, 0], [0, 0]].map(([la, lo]) => ({ lat: 50 + la, lon: 36 + lo }))
const osm: OsmFile = { elements: [{ type: 'way', id: 7, tags: { 'building:levels': '2' }, geometry: ring }] }

describe('toLocal', () => {
  it('north is -z, east is +x', () => {
    const [x, z] = toLocal(o, 50.001, 36.001)
    expect(z).toBeCloseTo(-111.32, 1)
    expect(x).toBeGreaterThan(70)
  })
})

describe('sampleCity', () => {
  const c = sampleCity(osm, o, 'way/7', 2000)
  it('keeps points on the building (walls 0–6 m, roof at 6 m)', () => {
    for (let i = 0; i < c.count; i++) {
      const [x, y, z] = [c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]]
      expect(y).toBeGreaterThanOrEqual(-1)
      expect(y).toBeLessThanOrEqual(7)
      expect(x).toBeGreaterThan(-2); expect(x).toBeLessThan(22)
      expect(z).toBeLessThan(2); expect(z).toBeGreaterThan(-22)
    }
  })
  it('respects the budget and marks the target', () => {
    expect(c.count).toBeGreaterThan(200)
    expect(c.count).toBeLessThan(2600)
    expect(c.target.every((t) => t === 1)).toBe(true)
    expect(sampleCity(osm, o, 'way/8', 2000).target.every((t) => t === 0)).toBe(true)
  })
  it('defaults to 5 floors without building:levels', () => {
    const noLv: OsmFile = { elements: [{ ...osm.elements[0], tags: {} }] }
    const ys = Array.from(sampleCity(noLv, o).positions.filter((_, i) => i % 3 === 1))
    expect(Math.max(...ys)).toBeGreaterThan(14)
  })
})

describe('wireCity', () => {
  it('3 segments per edge', () => {
    expect(wireCity(osm, o).count).toBe(4 * 3)
  })
})
