import { describe, expect, it } from 'vitest'
import { blinkAt, calloutState, clockAt, flashAt, heatAt, markTimes, slowmo, waveRadiusM } from './derive'
import { buildRuler } from './ruler'
import sample from '../../public/sample_incident.json'
import type { Incident } from '../types'

const inc = sample as unknown as Incident

describe('heatAt / flashAt', () => {
  it('calm before impact, red after, rewinds', () => {
    expect(heatAt(-0.1)).toBe(0)
    expect(heatAt(0.75)).toBeCloseTo(0.5)
    expect(heatAt(5)).toBe(1)
  })
  it('flash only around t = 0', () => {
    expect(flashAt(-0.01)).toBe(0)
    expect(flashAt(0)).toBe(1)
    expect(flashAt(0.7)).toBe(0)
  })
})

describe('calloutState', () => {
  const f = { t: 0, t_end: null }
  it('full for 4 s, then a pin, hidden before', () => {
    expect(calloutState(f, 2).state).toBe('full')
    expect(calloutState(f, 4.5).state).toBe('pin')
    expect(calloutState(f, -1).state).toBe('hidden')
  })
  it('t: null (checked, none found) never shows in the scene', () => {
    expect(calloutState({ t: null, t_end: null }, 0).state).toBe('hidden')
  })
  it('fully visible when you land exactly on its t', () => {
    expect(calloutState({ t: 41, t_end: 45 }, 41)).toEqual({ state: 'full', opacity: 1 })
  })
  it('honours t_end', () => {
    expect(calloutState({ t: 41, t_end: 45 }, 44).state).toBe('full')
    expect(calloutState({ t: 41, t_end: 45 }, 45).state).toBe('pin')
  })
})

describe('physics + clock', () => {
  it('wave at 343 m/s', () => expect(waveRadiusM(3.1)).toBeCloseTo(1063.3, 1))
  it('slow motion around impact only', () => {
    expect(slowmo(0)).toBe(0.25)
    expect(slowmo(10)).toBe(1)
  })
  it('camera A blinks at its measured boom (+3.1 s), not before', () => {
    expect(blinkAt(inc, 'A', 3.2)).toBe(true)
    expect(blinkAt(inc, 'A', 2.9)).toBe(false)
    expect(blinkAt(inc, 'D', 3.2)).toBe(false)
  })
  it('clock in the incident offset with ±', () => {
    expect(clockAt(inc, 0)).toBe('02:41:07 (±6 min)')
    expect(clockAt(inc, 60)).toBe('02:42:07 (±6 min)')
  })
})

describe('buildRuler', () => {
  const r = buildRuler(markTimes(inc))
  it('exactly one gap, ending 5 s before the second impact (t = 1080)', () => {
    expect(r.gaps.length).toBe(1)
    expect(r.gaps[0].t1).toBe(1075)
  })
  it('round-trips t ↔ x', () => {
    expect(r.xToT(r.tToX(41))).toBeCloseTo(41, 5)
    expect(r.xToT(r.tToX(1082))).toBeCloseTo(1082, 5)
    expect(r.tToX(r.start)).toBe(0)
    expect(r.tToX(r.end)).toBeCloseTo(1, 9)
  })
  it('checked-none flag (t: null) is not a mark', () => {
    expect(markTimes(inc).includes(null as unknown as number)).toBe(false)
  })
})
