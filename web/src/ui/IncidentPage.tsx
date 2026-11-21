import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Incident } from '../types'
import { loadIncident, loadOsm, type OsmPick } from '../data/load'
import { WitnessScene } from '../scene/Scene'
import { useTime } from '../time/store'
import { buildRuler } from '../time/ruler'
import { markTimes } from '../time/derive'
import { startLoop } from '../time/loop'
import { SampleBanner } from './SampleBanner'
import { Fps } from './Fps'
import { Timeline } from './Timeline'
import { Callouts } from './Callouts'
import { Clock, GapCard, LowerThird, NowPanel, TitleCard } from './HudText'
import { SourceVideo } from './SourceVideo'
import { FlagsList, Footer, Sources, Summary, WeaponBars } from './Sidebar'

/** §7.1 Reconstruction view. Everything below reads scene time t from the store. `?wire=1` or key W = wireframe. */
export function IncidentPage({ id }: { id: string }) {
  const [inc, setInc] = useState<Incident | null | undefined>(undefined)
  const [osm, setOsm] = useState<OsmPick | null | undefined>(undefined)
  const [wire, setWire] = useState(() => new URLSearchParams(window.location.search).get('wire') === '1')
  const [points, setPoints] = useState(0)
  const [showKey, setShowKey] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<WitnessScene | null>(null)
  const getScene = useCallback(() => scene.current, [])
  const ruler = useMemo(() => (inc ? buildRuler(markTimes(inc)) : null), [inc])

  useEffect(() => {
    loadIncident(id).then((i) => {
      setInc(i)
      if (i) loadOsm(i).then(setOsm)
    })
  }, [id])

  // Open on the establishing shot, paused (§7.1.8 #1).
  useEffect(() => { if (ruler) useTime.setState({ t: ruler.start, playing: false, mode: 'walk', pinned: null }) }, [ruler])

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'w' || e.key === 'W') setWire((w) => !w) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  useEffect(() => {
    if (!inc || !osm || !ruler || !canvas.current) return
    const s = new WitnessScene(canvas.current)
    s.load(inc, osm.osm, wire)
    scene.current = s
    if (import.meta.env.DEV) Object.assign(window, { __scene: s, __time: useTime }) // dev-only: console checks
    setPoints(s.points)
    // Any drag or scroll → Free (§7.1.4). 'start' alone fires on a plain click, so wait for a user-driven 'change'.
    let user = false
    s.controls.addEventListener('start', () => { user = true })
    s.controls.addEventListener('end', () => { user = false })
    s.controls.addEventListener('change', () => { if (user) useTime.getState().setMode('free') })
    const stop = startLoop(ruler, (t) => { s.update(t, useTime.getState().mode); s.render() })
    return () => { stop(); s.dispose(); scene.current = null }
  }, [inc, osm, wire, ruler])

  // Click (not drag) on a camera icon → show its clip.
  const down = useRef<[number, number]>([0, 0])
  const onUp = (e: React.PointerEvent) => {
    if (Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) > 4) return
    const id = scene.current?.pickCamera(e.clientX, e.clientY)
    if (id) useTime.getState().pin(id)
  }

  useEffect(() => { scene.current?.showAnswerKey(showKey) }, [showKey, points])

  if (inc === undefined) return <div className="page muted">Loading incident {id}…</div>
  if (inc === null) return <div className="page warn">Incident {id} not found (incidents/{id}.json).</div>

  return (
    <div className="recon">
      <SampleBanner show={inc.is_sample} />
      <div className="stage">
        <div className="scene">
          <canvas ref={canvas} onPointerDown={(e) => { down.current = [e.clientX, e.clientY] }} onPointerUp={onUp}
            onDoubleClick={(e) => { useTime.getState().setMode('free'); scene.current?.focusAt(e.clientX, e.clientY) }} />
          <TitleCard inc={inc} />
          {ruler && <GapCard ruler={ruler} />}
          <Callouts inc={inc} osm={osm?.osm ?? null} getScene={getScene} />
          <div className="hud-title">
            {inc.city.toUpperCase()} · INCIDENT #{inc.id} · {inc.verification.n_sources} SOURCES
            <div className="muted">{inc.title}</div>
            {osm === null && <div className="warn">Building file {inc.osm_file} not found under web/public/.</div>}
            {osm && !osm.inside && <div className="warn">Impact is {Math.round(osm.distance_m ?? 0)} m from the centre of {osm.file}; buildings may be missing.</div>}
          </div>
          <Clock inc={inc} />
          <LowerThird inc={inc} />
          <Fps points={points} />
          <div className="honesty">
            Geometry: OpenStreetMap footprints, heights estimated. Not a scan.{wire && ' (wireframe)'}<br />
            © OpenStreetMap contributors (ODbL)
          </div>
        </div>
        {ruler && <Timeline inc={inc} ruler={ruler} />}
      </div>
      <aside className="sidebar">
        <SourceVideo inc={inc} />
        <NowPanel inc={inc} />
        <Summary inc={inc} />
        <WeaponBars weapon={inc.weapon} />
        <FlagsList inc={inc} osm={osm?.osm ?? null} />
        <Sources inc={inc} />
        <Footer inc={inc} showKey={showKey} toggleKey={() => setShowKey((v) => !v)} />
      </aside>
    </div>
  )
}
