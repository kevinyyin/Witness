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

export type Markers = {
  group: THREE.Group
  flash: THREE.Sprite
  sphere: THREE.Mesh
  wave: THREE.Points
  waveMax: number // m: wave fades out once past the farthest camera
  icons: Record<string, THREE.Sprite> // camera icons by source id (they blink)
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
  const flash = sprite(glow(), new THREE.Color(1, 1, 1), 1, 6)
  flash.position.set(0, 10, 0)
  flash.visible = false
  // Uncertainty sphere: radius = impact.radius_m (§7.1.3)
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(o.radius_m, 24, 12),
    new THREE.MeshBasicMaterial({ color: AMBER, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  // Sound wave: translucent hemisphere of points, radius = 343 m/s × t (set per frame)
  const wave = new THREE.Points(hemisphere(2500), new THREE.PointsMaterial({
    color: CYAN, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false,
  }))
  wave.visible = false
  group.add(dot, flash, sphere, wave)

  const icons: Record<string, THREE.Sprite> = {}
  let waveMax = 600
  const unknownCameras: string[] = []
  for (const s of inc.sources) {
    const cam = s.camera
    if (!cam) { unknownCameras.push(s.id); continue }
    const [x, z] = toLocal(o, cam.lat, cam.lon)
    const g = new THREE.Group()
    g.position.set(x, 2, z)
    const icon = sprite(glow(), CYAN, 18, 2.2)
    icons[s.id] = icon
    waveMax = Math.max(waveMax, Math.hypot(x, z) * 1.15)
    const label = sprite(letter(s.id), CYAN, 26, 1.6)
    label.position.y = 26
    g.add(icon, label)
    // Position uncertainty: ring of radius camera.radius_m (never a point without its ±)
    if (cam.radius_m) g.add(line(circle(cam.radius_m), CYAN, 0.35, true))
    if (cam.heading_deg != null) {
      // shortcut: §9.2 has no camera location confidence; opacity falls with radius_m (60 m → 0.9, 350 m → 0.3). Swap in a real field if the pipeline adds one.
      const conf = Math.min(0.9, Math.max(0.15, 1 - (cam.radius_m ?? 300) / 500))
      const fov = ((cam.fov_deg ?? 60) * Math.PI) / 180, h = (cam.heading_deg * Math.PI) / 180
      const ray = (a: number) => new THREE.Vector3(Math.sin(a) * CONE_M, 0, -Math.cos(a) * CONE_M) // compass: 0 = north (-z)
      const [l, r] = [ray(h - fov / 2), ray(h + fov / 2)]
      const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), l, r])
      g.add(new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: conf * 0.3, side: THREE.DoubleSide, depthWrite: false })))
      g.add(line([l, new THREE.Vector3(), r], CYAN, conf))
    }
    group.add(g)
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
  return { group, flash, sphere, wave, waveMax, icons, answerKey, unknownCameras }
}
