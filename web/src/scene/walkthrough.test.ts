import { describe, expect, it } from 'vitest'
import { makeDirector, witnessAt, witnesses } from './walkthrough'
import sample from '../../public/sample_incident.json'
import type { Incident } from '../types'

const inc = sample as unknown as Incident
const shot = makeDirector(inc)
const finite = (p: { pos: { x: number; y: number; z: number } }) => [p.pos.x, p.pos.y, p.pos.z].every(Number.isFinite)

describe('director camera (§7.1.4)', () => {
  it('a finite pose at every beat, above the ground', () => {
    for (const t of [-20, -15, -10, -6, -2, 0, 0.5, 2, 5, 41, 1075]) {
      const p = shot(t)
      expect(finite(p)).toBe(true)
      expect(p.pos.y).toBeGreaterThan(20)
    }
  })
  it('a pure function of t: same t, same pose (scrubbing back rewinds the move)', () => {
    expect(shot(-5).pos.distanceTo(shot(-5).pos)).toBe(0)
  })
  it('no jumps at shot boundaries', () => {
    for (const b of [-10, -2, 1, 4.6]) expect(shot(b - 0.001).pos.distanceTo(shot(b + 0.001).pos)).toBeLessThan(2)
  })
  it('settles ~250 m from the target around impact', () => {
    expect(shot(0).pos.length()).toBeGreaterThan(200)
    expect(shot(0).pos.length()).toBeLessThan(300)
  })
  it('sweeps every positioned, non-rejected witness once, in order', () => {
    const ids = witnesses(inc).map((w) => w.id)
    expect(ids.sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    const seen = new Set<string>()
    for (let t = -10; t < -2; t += 0.1) seen.add(witnessAt(inc, t)!)
    expect(seen.size).toBe(5)
    expect(witnessAt(inc, 0)).toBeNull()
  })
  it('copes with an incident where no camera has a position', () => {
    const blind = { ...inc, sources: inc.sources.map((s) => ({ ...s, camera: null })) }
    const d = makeDirector(blind)
    for (const t of [-15, -6, 0, 3, 60]) expect(finite(d(t))).toBe(true)
    expect(d(-6).pos.distanceTo(d(-9).pos)).toBeGreaterThan(50) // still moving during the (empty) witness sweep
    for (const b of [-10, -2]) expect(d(b - 0.001).pos.distanceTo(d(b + 0.001).pos)).toBeLessThan(2)
  })
})
