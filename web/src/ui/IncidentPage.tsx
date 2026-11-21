import { useEffect, useRef, useState } from 'react'
import type { Incident } from '../types'
import { loadIncident, loadOsmFor, type OsmPick } from '../data/load'
import { WitnessScene } from '../scene/Scene'
import { SampleBanner } from './SampleBanner'
import { Fps } from './Fps'

/** §7.1 Reconstruction view. V1a: point-cloud city + free orbit + FPS. `?wire=1` or key W = wireframe fallback. */
export function IncidentPage({ id }: { id: string }) {
  const [inc, setInc] = useState<Incident | null | undefined>(undefined)
  const [osm, setOsm] = useState<OsmPick | null | undefined>(undefined)
  const [wire, setWire] = useState(() => new URLSearchParams(window.location.search).get('wire') === '1')
  const [points, setPoints] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)

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
    setPoints(s.points)
    let raf = 0
    const tick = () => { s.render(); raf = requestAnimationFrame(tick) }
    tick()
    return () => { cancelAnimationFrame(raf); s.dispose() }
  }, [inc, osm, wire])

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
        <div className="honesty">
          Geometry: OpenStreetMap footprints, heights estimated. Not a scan.{wire && ' (wireframe)'}<br />
          © OpenStreetMap contributors (ODbL)
        </div>
      </div>
      <aside className="sidebar muted">Sidebar (V3)</aside>
    </div>
  )
}
