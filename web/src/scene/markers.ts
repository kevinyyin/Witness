// §7.1.3 scene objects. Positions come only from the JSON: no camera → nothing drawn (listed as unknown).
// No missile, trajectory or flight path, ever (D6).
import * as THREE from 'three'
import type { Incident } from '../types'
import { toLocal } from './geo'

const AMBER = new THREE.Color(1.0, 0.69, 0.18)
const CYAN = new THREE.Color(0.5, 0.9, 1.0)
const GREEN = new THREE.Color(0.3, 1.0, 0.53)
const CONE_M = 150

let glowTex: THREE.Texture | null = null
function glow() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.8)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 64, 64)
  return (glowTex = new THREE.CanvasTexture(c))
}

function letter(text: string) {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(text, 32, 34)
  return new THREE.CanvasTexture(c)
}

/** Sprite sized in metres; `boost` > 1 pushes it over the bloom threshold (glows). */
function sprite(map: THREE.Texture, color: THREE.Color, size: number, boost = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color: color.clone().multiplyScalar(boost), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }))
  s.scale.setScalar(size)
  return s
}

function line(points: THREE.Vector3[], color: THREE.Color, opacity: number, loop = false) {
  const g = new THREE.BufferGeometry().setFromPoints(points)
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  return loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m)
}

const circle = (r: number, y = 0.5) =>
  Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2) * r, y, Math.sin((i / 48) * Math.PI * 2) * r))

/** A timeline event shown in the scene at its time: siren = faint area pulse, buzz = sound icon, fire/rescue stay as markers. */
export type Cue = { t: number; kind: 'pulse' | 'icon' | 'marker'; obj: THREE.Object3D }
const GLYPH: Record<string, string> = { engine_buzz: '♪', jet: '♪', fire: '✷', rescue: '+', burst: '✺', gunfire: '•', speech: '…' }

/** One per impact (§9.2: the top-level impact at t = 0, plus every later `impact` event): its own flash and sound wave. */
export type Blast = { t: number; flash: THREE.Sprite; wave: THREE.Points; waveMax: number }

export type Markers = {
  group: THREE.Group
  blasts: Blast[]
  sphere: THREE.Mesh
  icons: Record<string, THREE.Sprite> // camera icons by source id (they blink)
  cones: Record<string, { mats: (THREE.MeshBasicMaterial | THREE.LineBasicMaterial)[]; base: number[] }> // light up in the witness sweep
  rings: THREE.Group // evidence rings (toggle): radius = measured flash-to-boom distance
  cues: Cue[] // non-impact timeline events at their anchor (default: the source camera, §9.2)
  answerKey: THREE.Object3D | null
  unknownCameras: string[]
}

/** Upper hemisphere of points (unit radius) for the sound wave. */
function hemisphere(n: number) {
  const pos: number[] = []
  for (let i = 0; i < n; i++) {
    const y = i / n, r = Math.sqrt(1 - y * y), a = i * 2.39996 // golden angle
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r)
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
}

export function buildMarkers(inc: Incident): Markers {
  const o = inc.impact, group = new THREE.Group()

  const dot = sprite(glow(), AMBER, 16, 2.5)
  dot.position.set(0, 2, 0)
  // Uncertainty sphere: radius = impact.radius_m (§7.1.3)
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(o.radius_m, 24, 12),
    new THREE.MeshBasicMaterial({ color: AMBER, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  group.add(dot, sphere)

  // Impacts: t = 0 at the top-level impact, then any later `impact` event at its own point anchor (else the same spot).
  const at = [{ t: 0, pos: new THREE.Vector3() }, ...inc.timeline.filter((e) => e.type === 'impact' && e.t > 0).map((e) => {
    if (e.anchor?.kind !== 'point') return { t: e.t, pos: new THREE.Vector3() }
    const [x, z] = toLocal(o, e.anchor.lat, e.anchor.lon)
    return { t: e.t, pos: new THREE.Vector3(x, 0, z) }
  })]
  const cams = inc.sources.flatMap((s) => (s.camera ? [toLocal(o, s.camera.lat, s.camera.lon)] : []))
  const blasts: Blast[] = at.map(({ t, pos }) => {
    const flash = sprite(glow(), new THREE.Color(1, 1, 1), 1, 6)
    flash.position.set(pos.x, 10, pos.z)
    flash.visible = false
    // Sound wave: translucent hemisphere of points, radius = 343 m/s × (t − t_impact), set per frame
    const wave = new THREE.Points(hemisphere(2500), new THREE.PointsMaterial({
      color: CYAN, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false,
    }))
    wave.position.copy(pos)
    wave.visible = false
    group.add(flash, wave)
    const waveMax = Math.max(600, ...cams.map(([x, z]) => Math.hypot(x - pos.x, z - pos.z) * 1.15))
    return { t, flash, wave, waveMax }
  })

  const icons: Record<string, THREE.Sprite> = {}
  const cones: Markers['cones'] = {}
  const unknownCameras: string[] = []
  for (const s of inc.sources) {
    const cam = s.camera
    if (!cam) { unknownCameras.push(s.id); continue }
    const [x, z] = toLocal(o, cam.lat, cam.lon)
    const g = new THREE.Group()
    g.position.set(x, 2, z)
    const icon = sprite(glow(), CYAN, 18, 2.2)
    icons[s.id] = icon
    const label = sprite(letter(s.id), CYAN, 26, 1.6)
    label.position.y = 26
    g.add(icon, label)
    // Position uncertainty: ring of radius camera.radius_m (never a point without its ±)
    g.add(line(circle(cam.radius_m), CYAN, 0.35, true))
    {
      const conf = cam.confidence // §7.1.3: cone opacity = location confidence
      const fov = (cam.fov_deg * Math.PI) / 180, h = (cam.heading_deg * Math.PI) / 180
      const ray = (a: number) => new THREE.Vector3(Math.sin(a) * CONE_M, 0, -Math.cos(a) * CONE_M) // compass: 0 = north (-z)
      const [l, r] = [ray(h - fov / 2), ray(h + fov / 2)]
      const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), l, r])
      const fill = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: conf * 0.3, side: THREE.DoubleSide, depthWrite: false })
      const edge = line([l, new THREE.Vector3(), r], CYAN, conf)
      g.add(new THREE.Mesh(tri, fill), edge)
      cones[s.id] = { mats: [fill, edge.material as THREE.LineBasicMaterial], base: [conf * 0.3, conf] }
    }
    group.add(g)
  }

  // Evidence rings: dashed ground circle around each camera, radius = boom_distance_m (none when null)
  const rings = new THREE.Group()
  rings.visible = false
  for (const s of inc.sources) {
    if (!s.camera || s.boom_distance_m == null) continue
    const [x, z] = toLocal(o, s.camera.lat, s.camera.lon)
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle(s.boom_distance_m, 1)),
      new THREE.LineDashedMaterial({ color: CYAN, dashSize: 14, gapSize: 10, transparent: true, opacity: 0.6 }))
    ring.computeLineDistances()
    ring.position.set(x, 0, z)
    rings.add(ring)
  }
  group.add(rings)

  // Event cues at their anchor: an explicit point anchor, else the source camera; a source without a camera gets none.
  const cues: Cue[] = []
  for (const e of inc.timeline) {
    if (e.type === 'impact' || e.type === 'boom_heard') continue
    let pos: THREE.Vector3 | null = null
    if (e.anchor?.kind === 'point') { const [x, z] = toLocal(o, e.anchor.lat, e.anchor.lon); pos = new THREE.Vector3(x, 2, z) }
    else { const c = inc.sources.find((s) => s.id === e.source)?.camera; if (c) { const [x, z] = toLocal(o, c.lat, c.lon); pos = new THREE.Vector3(x, 2, z) } }
    if (!pos) continue
    let obj: THREE.Object3D, kind: Cue['kind']
    if (e.type === 'siren') {
      obj = line(circle(1, 1), CYAN, 0.35, true); kind = 'pulse'
    } else {
      obj = sprite(letter(GLYPH[e.type] ?? '•'), e.type === 'fire' ? AMBER : e.type === 'rescue' ? GREEN : CYAN, 30, 1.6)
      obj.position.y = 50
      kind = e.type === 'fire' || e.type === 'rescue' ? 'marker' : 'icon'
    }
    const holder = new THREE.Group()
    holder.position.copy(pos)
    holder.add(obj)
    holder.visible = false
    group.add(holder)
    cues.push({ t: e.t, kind, obj: holder })
  }

  let answerKey: THREE.Object3D | null = null
  if (inc.answer_key) {
    const [x, z] = toLocal(o, inc.answer_key.lat, inc.answer_key.lon)
    answerKey = new THREE.Group()
    answerKey.position.set(x, 0, z)
    const pin = sprite(glow(), GREEN, 14, 2.5)
    pin.position.y = 3
    answerKey.add(pin, line([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 80, 0)], GREEN, 0.8))
    answerKey.visible = false
    group.add(answerKey)
  }
  return { group, blasts, sphere, icons, cones, rings, cues, answerKey, unknownCameras }
}
