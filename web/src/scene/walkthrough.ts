// §7.1.4 Walkthrough: a documentary-style director camera, generated from the incident JSON.
// The pose is a pure function of t (no keyframes, nothing stored), so scrubbing backward rewinds the move too.
import * as THREE from 'three'
import type { Incident } from '../types'
import { toLocal } from './geo'
import { DEFAULT_LEVELS, FLOOR_M } from './pointcloud'

export type Pose = { pos: THREE.Vector3; look: THREE.Vector3 }
type Shot = { t0: number; t1: number; at: (t: number) => Pose }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
const mix = (a: Pose, b: Pose, k: number): Pose => ({ pos: a.pos.clone().lerp(b.pos, k), look: a.look.clone().lerp(b.look, k) })
const BLEND = 0.8 // s of cross-fade on each side of a shot boundary
const DIR = V(-Math.SQRT1_2, 0, Math.SQRT1_2) // establishing side: from the south-west

/** Witness cameras (with a position, not rejected) in compass order around the impact, so the sweep pans smoothly. */
export function witnesses(inc: Incident) {
  return inc.sources
    .filter((s) => s.camera && s.authenticity !== 'fake')
    .map((s) => { const [x, z] = toLocal(inc.impact, s.camera!.lat, s.camera!.lon); return { id: s.id, x, z, bearing: Math.atan2(x, -z) } })
    .sort((a, b) => a.bearing - b.bearing)
}

/** Which witness the sweep is on (−10 → −2 s: one equal slot each), else null. */
export function witnessAt(inc: Incident, t: number): string | null {
  const ws = witnesses(inc)
  if (!ws.length || t < -10 || t >= -2) return null
  return ws[Math.min(ws.length - 1, Math.floor(((t + 10) / 8) * ws.length))].id
}

export function makeDirector(inc: Incident): (t: number) => Pose {
  const h = (inc.target?.levels || DEFAULT_LEVELS) * FLOOR_M
  const focus = V(0, h * 0.5, 0)
  const ws = witnesses(inc)
  const far = Math.max(400, ...ws.map((w) => Math.hypot(w.x, w.z)))
  const lastBoom = Math.max(0, ...inc.timeline.filter((e) => e.type === 'boom_heard').map((e) => e.t))
  const waveEnd = Math.max(3, lastBoom + 1.5)

  const establishing = (t: number): Pose => {
    const k = smooth((t + 20) / 10) // slow push toward the target
    return { pos: DIR.clone().multiplyScalar(1100 - 350 * k).setY(700 - 280 * k), look: focus.clone() }
  }
  const witnessPose = (i: number): Pose => {
    const w = ws[i], out = V(w.x, 0, w.z).normalize()
    // just behind and above the witness, looking past it toward the impact (its point of view)
    return { pos: V(w.x, 0, w.z).addScaledVector(out, 220).setY(90), look: V(w.x, 10, w.z).lerp(focus, 0.35) }
  }
  const sweep = (t: number): Pose => {
    if (!ws.length) return establishing(-10)
    const u = Math.min(ws.length - 1e-6, Math.max(0, ((t + 10) / 8) * ws.length))
    const i = Math.floor(u), f = u - i
    return i + 1 < ws.length ? mix(witnessPose(i), witnessPose(i + 1), smooth((f - 0.6) / 0.4)) : witnessPose(i)
  }
  const impact = (): Pose => ({ pos: DIR.clone().multiplyScalar(230).setY(110), look: focus.clone() }) // ~250 m from the target
  const wave = (t: number): Pose => {
    const k = smooth((t - 1) / Math.max(1, waveEnd - 1)), d = 250 + (far * 1.3 + 150 - 250) * k // pull up and back
    return { pos: DIR.clone().multiplyScalar(d * 0.75).setY(110 + (d * 0.85 - 110) * k), look: V(0, h * 0.5 * (1 - k), 0) }
  }
  const orbit = (t: number): Pose => {
    const a = Math.atan2(DIR.x, -DIR.z) + (t - waveEnd) * 0.06
    const w = wave(waveEnd)
    const r = Math.hypot(w.pos.x, w.pos.z), y = w.pos.y
    return { pos: V(Math.sin(a) * r, y, -Math.cos(a) * r), look: w.look }
  }

  const shots: Shot[] = [
    { t0: -Infinity, t1: -10, at: establishing },
    { t0: -10, t1: -2, at: sweep },
    { t0: -2, t1: 1, at: impact },
    { t0: 1, t1: waveEnd, at: wave },
    { t0: waveEnd, t1: Infinity, at: orbit },
  ]
  return (t) => {
    const i = shots.findIndex((s) => t >= s.t0 && t < s.t1)
    const s = shots[i]
    if (i > 0 && t - s.t0 < BLEND) return mix(shots[i - 1].at(t), s.at(t), smooth((t - (s.t0 - BLEND)) / (2 * BLEND)))
    if (i < shots.length - 1 && s.t1 - t < BLEND) return mix(s.at(t), shots[i + 1].at(t), smooth((t - (s.t1 - BLEND)) / (2 * BLEND)))
    return s.at(t)
  }
}
