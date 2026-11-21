import { describe, expect, it } from 'vitest'
import { distanceM } from './load'

describe('distanceM', () => {
  it('~111 km per degree of latitude', () => {
    expect(distanceM({ lat: 50, lon: 36 }, { lat: 51, lon: 36 })).toBeGreaterThan(111000)
    expect(distanceM({ lat: 50, lon: 36 }, { lat: 51, lon: 36 })).toBeLessThan(111400)
  })
})
