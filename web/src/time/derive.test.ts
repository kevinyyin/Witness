import { describe, expect, it } from 'vitest'
import { flashAt, heatAt } from './derive'

describe('heatAt', () => {
  it('calm before impact, red after, rewinds', () => {
    expect(heatAt(-0.1)).toBe(0)
    expect(heatAt(0)).toBe(0)
    expect(heatAt(0.75)).toBeCloseTo(0.5)
    expect(heatAt(5)).toBe(1)
  })
})

describe('flashAt', () => {
  it('only around t = 0', () => {
    expect(flashAt(-0.01)).toBe(0)
    expect(flashAt(0)).toBe(1)
    expect(flashAt(0.7)).toBe(0)
  })
})
