import { useEffect, useRef, useState } from 'react'
import type { Incident } from '../types'
import { loadIncident, loadOsmFor, type OsmPick } from '../data/load'
import { WitnessScene } from '../scene/Scene'
import { useTime } from '../time/store'
import { SampleBanner } from './SampleBanner'
import { Fps } from './Fps'

/** §7.1 Reconstruction view. V1a: point-cloud city + free orbit + FPS. `?wire=1` or key W = wireframe fallback. */
export function IncidentPage({ id }: { id: string }) {
  const [inc, setInc] = useState<Incident | null | undefined>(undefined)
  const [osm, setOsm] = useState<OsmPick | null | undefined>(undefined)
  const [wire, setWire] = useState(() => new URLSearchParams(window.location.search).get('wire') === '1')
  const [points, setPoints] = useState(0)
  const [showKey, setShowKey] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<WitnessScene | null>(null)
  const { t, setT } = useTime()

  useEffect(() => {
    loadIncident(id).then((i) => {
      setInc(i)
      if (i) loadOsmFor(i.impact).then(setOsm)
    })
  }, [id])

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'w' || e.key === 'W') setWire((w) => !w) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  useEffect(() => {
    if (!inc || !osm || !canvas.current) return
    const s = new WitnessScene(canvas.current)
    s.load(inc, osm.osm, wire)
    scene.current = s
    if (import.meta.env.DEV) (window as any).__scene = s // dev-only: lets us time frames from the console
    setPoints(s.points)
    let raf = 0
    const tick = () => { s.update(useTime.getState().t); s.render(); raf = requestAnimationFrame(tick) }
    tick()
    return () => { cancelAnimationFrame(raf); s.dispose(); scene.current = null }
  }, [inc, osm, wire])

  useEffect(() => { scene.current?.showAnswerKey(showKey) }, [showKey, points])

  if (inc === undefined) return <div className="page muted">Loading incident {id}…</div>
  if (inc === null) return <div className="page warn">Incident {id} not found (incidents/{id}.json).</div>

  return (
    <div className="recon">
      <SampleBanner show={inc.is_sample} />
      <div className="stage">
        <canvas ref={canvas} />
        <div className="hud-title">
          {inc.city.toUpperCase()} · INCIDENT #{inc.id} · {inc.sources.length} SOURCES
          <div className="muted">{inc.title}</div>
          {osm === null && <div className="warn">No OSM extract found (web/public/osm/index.json).</div>}
          {osm && !osm.inside && <div className="warn">Impact is {Math.round(osm.distance_m)} m from the nearest OSM extract ({osm.entry.file}); buildings may be missing.</div>}
        </div>
        <Fps points={points} />
        <div className="hud-tools">
          {/* temp until the V2 timeline */}
          <label>t = {t >= 0 ? '+' : ''}{t.toFixed(1)} s{' '}
            <input type="range" min={-20} max={30} step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} />
          </label>
          {inc.answer_key && (
            <button onClick={() => setShowKey((v) => !v)}>
              Investigators' location: {showKey ? 'shown' : 'reveal'}
            </button>
          )}
          {inc.sources.some((s) => !s.camera) && (
            <div className="muted">Position unknown: {inc.sources.filter((s) => !s.camera).map((s) => s.id).join(', ')}</div>
          )}
        </div>
        <div className="honesty">
          Geometry: OpenStreetMap footprints, heights estimated. Not a scan.{wire && ' (wireframe)'}<br />
          © OpenStreetMap contributors (ODbL)
        </div>
      </div>
      <aside className="sidebar muted">Sidebar (V3)</aside>
    </div>
  )
}
