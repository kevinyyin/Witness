import { describe, expect, it } from 'vitest'
import { distanceM, normalizeIndex } from './load'

describe('normalizeIndex', () => {
  it('accepts a bare array', () => {
    const r = normalizeIndex([{ id: '1', city: 'Kharkiv', title: 'x' }], false)
    expect(r?.incidents.length).toBe(1)
    expect(r?.is_sample).toBe(false)
  })
  it('accepts {incidents, run}', () => {
    const r = normalizeIndex({ incidents: [], run: { n_clips: 3 } }, true)
    expect(r?.run?.n_clips).toBe(3)
    expect(r?.is_sample).toBe(true)
  })
  it('rejects junk (e.g. index.html served for a missing file)', () => {
    expect(normalizeIndex('<!doctype html>', false)).toBeNull()
    expect(normalizeIndex(null, false)).toBeNull()
  })
})

describe('distanceM', () => {
  it('~111 km per degree of latitude', () => {
    expect(distanceM({ lat: 50, lon: 36 }, { lat: 51, lon: 36 })).toBeGreaterThan(111000)
    expect(distanceM({ lat: 50, lon: 36 }, { lat: 51, lon: 36 })).toBeLessThan(111400)
  })
})
