import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { Incident, OsmFile } from '../types'
import { groundGrid, sampleCity, wireCity } from './pointcloud'
import { buildMarkers, type Markers } from './markers'
import { blinkAt, flashAt, heatAt, waveRadiusM } from '../time/derive'
import type { Mode } from '../time/store'
import { makeDirector, witnessAt, type Pose } from './walkthrough'
import { toLocal } from './geo'

/** Frame counter read by the FPS box. */
export const frameStats = { frames: 0 }

// §7.1.2: cool white/cyan, brighter with height, distant points fade to black.
// Target points heat white → amber → red with uHeat (0..1).
const VERT = /* glsl */ `
attribute float aTarget;
uniform float uHeat, uSize, uDim, uFogNear, uFogFar;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  vec3 c = mix(vec3(0.36, 0.60, 0.70), vec3(0.82, 0.95, 1.0), clamp(position.y / 60.0, 0.0, 1.0)) * uDim;
  vec3 amber = vec3(1.0, 0.62, 0.15);
  vec3 hot = uHeat < 0.5 ? mix(vec3(1.0), amber, uHeat * 2.0) : mix(amber, vec3(1.0, 0.16, 0.08), uHeat * 2.0 - 1.0);
  c = mix(c, hot, aTarget * step(0.001, uHeat));
  vColor = c * (1.0 - smoothstep(uFogNear, uFogFar, d));
  gl_PointSize = clamp(uSize / d, 1.0, 3.5);
  gl_Position = projectionMatrix * mv;
}`
const FRAG = /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`

function geometry(positions: Float32Array, target: Float32Array) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('aTarget', new THREE.BufferAttribute(target, 1))
  return g
}

export class WitnessScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 8000)
  readonly controls: OrbitControls
  points = 0
  markers: Markers | null = null
  private mats: THREE.ShaderMaterial[] = []
  private composer: EffectComposer

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setClearColor(0x000000) // black void, no sky
    this.camera.position.set(-650, 420, 650)
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, { enableDamping: true, maxPolarAngle: Math.PI * 0.49, minDistance: 30, maxDistance: 3000 })
    this.controls.target.set(0, 20, 0)
    // Bloom only on light sources (§7.1.2): city colours stay below the threshold, markers are boosted above it.
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 1.2, 0.5, 0.95))
    this.composer.addPass(new OutputPass())
  }

  private material(dim: number) {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uHeat: { value: 0 }, uDim: { value: dim }, uFogNear: { value: 500 }, uFogFar: { value: 1900 },
        uSize: { value: 650 * this.renderer.getPixelRatio() },
      },
    })
    this.mats.push(m)
    return m
  }

  /** Builds the city around `impact` (local origin). `wire` = §7.1.2 fallback. */
  load(inc: Incident, osm: OsmFile, wire: boolean) {
    this.clear()
    const targetId = inc.target?.osm_id
    if (wire) {
      const w = wireCity(osm, inc.impact, targetId)
      this.scene.add(new THREE.LineSegments(geometry(w.positions, w.target), this.material(0.9)))
      this.points = 0
    } else {
      const c = sampleCity(osm, inc.impact, targetId)
      this.scene.add(new THREE.Points(geometry(c.positions, c.target), this.material(0.9)))
      this.points = c.count
    }
    const g = groundGrid(osm.radius_m ?? 900, 8)
    this.scene.add(new THREE.Points(geometry(g, new Float32Array(g.length / 3)), this.material(0.22)))
    this.points += g.length / 3
    this.markers = buildMarkers(inc)
    this.scene.add(this.markers.group)
    this.inc = inc
    this.director = makeDirector(inc)
  }

  private inc: Incident | null = null
  private director: ((t: number) => Pose) | null = null

  /** Everything time-dependent is set from `t` here, every frame (D14). */
  update(t: number, mode: Mode) {
    if (mode === 'walk' && this.director) { // director camera (§7.1.4); Free mode leaves OrbitControls in charge
      const p = this.director(t)
      this.camera.position.copy(p.pos)
      this.controls.target.copy(p.look)
    }
    // The depth fog follows the camera: with fixed distances the whole city faded to black when zoomed out.
    const dist = this.camera.position.distanceTo(this.controls.target)
    for (const m of this.mats) {
      m.uniforms.uHeat.value = heatAt(t)
      m.uniforms.uFogNear.value = Math.max(500, dist * 0.5)
      m.uniforms.uFogFar.value = Math.max(1900, dist * 1.9)
    }
    if (!this.markers || !this.inc) return
    const { blasts, sphere, icons, cones } = this.markers
    const w = witnessAt(this.inc, t)
    // lit cone in the witness sweep: edge full, fill capped so it never turns into a solid wedge
    for (const [id, c] of Object.entries(cones)) c.mats.forEach((m, i) => { m.opacity = id !== w ? c.base[i] : i === 0 ? Math.min(0.35, c.base[0] * 1.5) : 1 })
    for (const b of blasts) {
      const f = flashAt(t - b.t), r = waveRadiusM(t - b.t)
      b.flash.visible = f > 0
      b.flash.scale.setScalar(60 + 220 * (1 - f))
      b.flash.material.opacity = f
      b.wave.visible = r > 0 && r < b.waveMax
      b.wave.scale.setScalar(Math.max(r, 0.001))
      ;(b.wave.material as THREE.PointsMaterial).opacity = 0.55 * (1 - r / b.waveMax)
    }
    const f0 = flashAt(t)
    sphere.scale.setScalar(1 + 0.15 * f0) // pulse at the first impact
    ;(sphere.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.4 * f0
    for (const [id, icon] of Object.entries(icons)) icon.scale.setScalar(blinkAt(this.inc, id, t) ? 60 : 18)
    for (const c of this.markers.cues) { // §7.1.5: siren pulse, buzz icon (3–4 s), fire/rescue markers stay
      const dt = t - c.t
      c.obj.visible = dt >= 0 && (c.kind === 'marker' || dt < (c.kind === 'pulse' ? 4 : 3))
      if (!c.obj.visible) continue
      if (c.kind === 'pulse') c.obj.scale.setScalar(40 + ((dt % 1.5) / 1.5) * 360)
      else c.obj.scale.setScalar(1 + 0.25 * Math.max(0, Math.sin(dt * 8)) * (c.kind === 'icon' ? 1 : 0))
    }
  }

  /** Source id of the camera icon under a click, if any (§7.1.7: clicking a camera selects its clip). */
  pickCamera(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera)
    const icons = Object.entries(this.markers?.icons ?? {})
    const hit = ray.intersectObjects(icons.map(([, s]) => s))[0]
    return hit ? icons.find(([, s]) => s === hit.object)![0] : null
  }

  /** Free mode: double-click → orbit around that spot on the ground, ~250 m away (§7.1.4). */
  focusAt(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera)
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
    if (!hit) return
    const back = this.camera.position.clone().sub(this.controls.target).setLength(250)
    this.controls.target.copy(hit)
    this.camera.position.copy(hit).add(back)
  }

  /** Screen position (CSS px in the canvas) of a scene point. */
  project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera)
    return { x: ((v.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - v.y) / 2) * this.canvas.clientHeight, visible: v.z > -1 && v.z < 1 }
  }

  showAnswerKey(on: boolean) { if (this.markers?.answerKey) this.markers.answerKey.visible = on }
  showRings(on: boolean) { if (this.markers) this.markers.rings.visible = on }

  /** True when the pointer is over the target building's footprint (hover label: type and floors, §7.1.3). */
  overTarget(clientX: number, clientY: number): boolean {
    const tg = this.inc?.target
    if (!tg) return false
    const r = this.canvas.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera)
    const h = (tg.levels || 5) * 3
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h / 2), new THREE.Vector3())
    if (!hit) return false
    const poly = tg.footprint.map(([lon, lat]) => toLocal(this.inc!.impact, lat, lon))
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j]
      if ((zi > hit.z) !== (zj > hit.z) && hit.x < ((xj - xi) * (hit.z - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }

  render() {
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (w && h && (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.camera.aspect !== w / h)) {
      this.renderer.setSize(w, h, false)
      this.composer.setPixelRatio(this.renderer.getPixelRatio())
      this.composer.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
    this.controls.update()
    this.composer.render()
    frameStats.frames++
  }

  private clear() {
    this.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    this.scene.clear()
    for (const m of this.mats) m.dispose()
    this.mats = []
    this.markers = null
  }

  dispose() {
    this.clear()
    this.controls.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
