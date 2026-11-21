// §7.2 Break-it panel: a judge pastes a YouTube link or drops a video; stages tick live; verdict with reasons;
// "What was it really?" feeds a scoreboard where wrong answers stay. Offline → replay the recorded fixtures.
import { useEffect, useRef, useState } from 'react'
import type { ClipRecord } from '../types'
import type { StageEvent, StageName, StreamEvent } from '../breakit/sse'
import { analyze, health, judge, replayFixture, scoreboard, type Fixture, type Health, type Scoreboard, type Truth } from '../breakit/api'
import { mmss } from '../time/derive'
import { loadYouTube, videoAdapter, youtubeAdapter, youtubeId, type Adapter } from './players'
import { SampleBanner } from './SampleBanner'
import { WeaponBars } from './Sidebar'

const STAGES: [StageName, string][] = [
  ['fetch', 'Fetching'], ['watch', 'Watching & listening (Hydrogen)'], ['physics', 'Physics checks'],
  ['score', 'Scoring (Decisions API)'], ['locate', 'Locating'], ['verdict', 'Verdict'],
]
const ICON = { start: '⟳', done: '✓', skipped: '–', error: '✗' }
const TRUTHS: [Truth, string][] = [
  ['real_strike', 'Real strike'], ['video_game', 'Game'], ['movie', 'Movie'], ['fireworks_demolition', 'Fireworks/demolition'], ['other', 'Other'],
]
const LABEL: Record<string, string> = { video_game: 'video game', not_war: 'not war', real_strike: 'real strike' }

export function BreakIt() {
  const [h, setH] = useState<Health | null | undefined>(undefined)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [place, setPlace] = useState('')
  const [stages, setStages] = useState<Partial<Record<StageName, StageEvent>>>({})
  const [result, setResult] = useState<ClipRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [board, setBoard] = useState<Scoreboard | null>(null)
  const [judged, setJudged] = useState(false)
  // what this run was given: its video shows the moment Analyze is pressed, so nobody waits on a list of stage names
  const [sent, setSent] = useState<{ n: number; yt: string | null; file: File | null } | null>(null)
  const adapter = useRef<Adapter | null>(null)
  const started = useRef(0)
  const ended = useRef(false) // a result or an error arrived: anything else is a dropped stream

  useEffect(() => { health().then(setH); scoreboard().then(setBoard) }, [])
  useEffect(() => { // a file dropped anywhere on the page is taken; without this a near miss makes the browser open the file
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) { setFile(f); setUrl('') } }
    window.addEventListener('dragover', over); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setElapsed((performance.now() - started.current) / 1000), 200)
    return () => clearInterval(id)
  }, [busy])

  const offline = h === null
  const onEvent = (e: StreamEvent) => {
    if (e.event === 'stage') setStages((s) => ({ ...s, [e.data.stage]: e.data }))
    else if (e.event === 'result') { ended.current = true; setResult(e.data as ClipRecord) }
    else { ended.current = true; setError(`${e.data.stage}: ${e.data.message}`) }
  }
  const run = async (go: () => Promise<void>) => {
    setStages({}); setResult(null); setError(null); setJudged(false); setBusy(true)
    started.current = performance.now(); setElapsed(0); ended.current = false
    try {
      await go()
      if (!ended.current) setError('The connection closed before a verdict. Press Analyze again.')
    } catch (err) {
      setError((err as Error).name === 'TimeoutError' ? 'No verdict after 2 minutes, stopped. Press Analyze again, or try a shorter clip.' : String((err as Error).message ?? err))
    }
    finally { setBusy(false); setElapsed((performance.now() - started.current) / 1000) } // a hidden tab throttles the ticker: set the total here
  }
  const submit = () => { setSent({ n: (sent?.n ?? 0) + 1, yt: file ? null : youtubeId(url), file }); return run(() => analyze(file ? { file, claimed_place: place || null } : { url: url.trim(), claimed_place: place || null }, onEvent)) }
  const replay = (f: Fixture) => { setSent(null); return run(() => replayFixture(f, onEvent)) }
  const tell = async (truth: Truth) => {
    if (!result) return
    try { setBoard(await judge(result.clip_id, truth)); setJudged(true) } catch (err) { setError(String((err as Error).message)) }
  }

  const yt = sent && !sent.file ? (youtubeId(result?.embed_url ?? '') ?? sent.yt) : null
  const playable = !!sent && (!!yt || !!sent.file)
  const go = (ts: number) => { adapter.current?.seek(Math.max(0, ts - 1.5)); adapter.current?.play() } // start just before the moment

  return (
    <div className="page breakit">
      <SampleBanner show={offline} />
      <h2>Break it <span className="muted">· paste a YouTube link or drop a video · ≤ 60 s · first 3 min only</span></h2>
      {h === undefined && <p className="muted">Checking the pipeline server…</p>}
      {offline && (
        <p className="warn">Pipeline server not reachable (/api/health). Replaying recorded runs:{' '}
          <button onClick={() => replay('analyze_fake')} disabled={busy}>Replay: rejected clip</button>{' '}
          <button onClick={() => replay('analyze_real')} disabled={busy}>Replay: real strike</button>
        </p>
      )}
      {h && (
        <div className="bk-input">
          {h.youtube_url_input
            ? <input placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => { setUrl(e.target.value); setFile(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy && url.trim()) submit() }} />
            : <div className="muted">YouTube links are off for this run (K1); drop a video file instead.</div>}
          <label className="drop" onDragOver={(e) => e.preventDefault()} >
            {file ? `▶ ${file.name}` : 'or drop a video file here (any format)'}
            <input type="file" accept="video/*,.webm,.mkv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setUrl('') } }} />
          </label>
          <input placeholder="claimed place (optional, like the text of a post)" value={place} onChange={(e) => setPlace(e.target.value)} />
          <button onClick={submit} disabled={busy || (!file && !url.trim())}>Analyze</button>
        </div>
      )}

      <div className="bk-cols">
        <section className="bk-stages">
          <h4>LIVE <span className="muted">{busy || result ? `${elapsed.toFixed(1)} s` : ''}</span></h4>
          {STAGES.map(([k, name]) => {
            const s = stages[k]
            return (
              <div key={k} className={`stage-row ${s?.status ?? 'pending'}`}>
                <span className="icon">{s ? ICON[s.status] : '·'}</span> {name}
                {s?.summary && <span className="muted"> — {s.summary}</span>}
                {s?.ms != null && <span className="muted"> ({(s.ms / 1000).toFixed(1)} s)</span>}
              </div>
            )
          })}
          {error && <div className="warn">✗ {error}</div>}
        </section>
        <div className="bk-right">
          {playable && <ClipPlayer key={sent!.n} yt={yt} file={sent!.file} graphic={result?.triage.graphic_level ?? 0} adapter={adapter} />}
          {playable && busy && !result && <div className="muted">Play it while Witness works. The verdict lands here.</div>}
          {result && <Verdict key={result.clip_id} r={result} playable={playable} go={go} />}
        </div>
      </div>

      {result && (
        <section className="bk-judge">
          <h4>WHAT WAS IT REALLY?</h4>
          {TRUTHS.map(([t, label]) => <button key={t} disabled={offline || judged} onClick={() => tell(t)}>{label}</button>)}
          {offline && <span className="muted"> (the scoreboard lives on the pipeline server)</span>}
        </section>
      )}
      {board && (
        <section className="bk-board">
          <h4>SCOREBOARD <span className="big">Judge tries: {board.tries} · Witness right: {board.right}</span></h4>
          {board.history.map((x, i) => (
            <div key={i} className={x.right ? 'ok' : 'wrong'}>{x.right ? '✓' : '✗'} {x.clip_id}: Witness said {x.verdict}{x.label ? ` (${LABEL[x.label] ?? x.label})` : ''}, judge said {x.truth.replace(/_/g, ' ')}</div>
          ))}
        </section>
      )}
    </div>
  )
}

/** The clip being analyzed. Every timed line on the verdict card seeks it, so a claim can be checked in one click. */
function ClipPlayer({ yt, file, graphic, adapter }: { yt: string | null; file: File | null; graphic: number; adapter: { current: Adapter | null } }) {
  const box = useRef<HTMLDivElement>(null), vid = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  // same rule as the reconstruction sidebar: graphic >= 2 is blurred. The level is only known once scoring is done,
  // so a clip that turns out graphic is paused and covered at that moment.
  const [override, setOverride] = useState(false)
  const shown = graphic < 2 || override
  useEffect(() => { if (!shown) adapter.current?.pause() }, [shown, adapter])
  useEffect(() => {
    if (yt || !file) return
    const u = URL.createObjectURL(file)
    setSrc(u)
    return () => URL.revokeObjectURL(u)
  }, [yt, file])
  useEffect(() => {
    let alive = true
    if (yt) loadYouTube().then((YT) => {
      if (!alive || !box.current) return
      const p = new YT.Player(box.current, { videoId: yt, playerVars: { playsinline: 1, rel: 0 }, events: { onReady: () => { if (alive) adapter.current = youtubeAdapter(p) } } })
    })
    else if (vid.current) adapter.current = videoAdapter(vid.current)
    return () => { alive = false; adapter.current?.destroy(); adapter.current = null }
  }, [yt, src, adapter])
  return (
    <div className={`video-box ${shown ? '' : 'blurred'}`}>
      {yt ? <div><div ref={box} /></div> : <video ref={vid} src={src ?? undefined} playsInline controls preload="auto" />}
      {!shown && <div className="blur-cover">Graphic content (level {graphic}) · blurred<button onClick={() => setOverride(true)}>Show anyway</button></div>}
    </div>
  )
}

/** OpenStreetMap's own embed: the view spans the uncertainty radius, the pin is the best guess. */
function LocMap({ lat, lon, radius_m }: { lat: number; lon: number; radius_m: number }) {
  const dLat = (Math.max(radius_m, 150) * 1.2) / 111_320, dLon = dLat / Math.cos((lat * Math.PI) / 180)
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((x) => x.toFixed(5)).join(',')
  return <iframe className="bk-map" title="Estimated location on OpenStreetMap" loading="lazy"
    src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)},${lon.toFixed(5)}`} />
}

function Verdict({ r, playable, go }: { r: ClipRecord; playable: boolean; go: (ts: number) => void }) {
  const f = r.fake
  const rejected = f.verdict === 'fake'
  const title = rejected ? `Rejected · ${LABEL[f.label ?? ''] ?? f.label ?? 'not real'}` : f.verdict === 'real' ? 'Real strike footage' : 'Unsure · needs a human reviewer'
  const loc = r.location
  return (
    <section className={`verdict ${f.verdict}`}>
      <h3>{title} <span className="muted">conf {f.confidence.toFixed(2)}</span></h3>
      {r.timeline.length > 0 && (
        <div className="bk-events">
          <span className="muted">What Hydrogen saw and heard{playable ? ' (click to check)' : ''}: </span>
          {r.timeline.map((e, i) => <button key={i} className="mini" disabled={!playable} onClick={() => go(e.clip_ts)}>{mmss(e.clip_ts)} {e.label} ▸</button>)}
        </div>
      )}
      {f.checks.map((c) => (
        <div key={c.name} className={`check ${c.result === 'fail' ? 'fail' : ''}`}>
          {c.result === 'pass' ? '✓' : c.result === 'fail' ? '✗' : '–'} {c.name.replace(/_/g, ' ')}: {c.detail}{c.clip_ts != null && (playable
            ? <> <button className="mini" onClick={() => go(c.clip_ts!)}>▸ play {mmss(c.clip_ts)}</button></>
            : <span className="muted"> @ {mmss(c.clip_ts)}</span>)}
        </div>
      ))}
      {!rejected && (
        <>
          <div className="bk-loc">
            {loc ? <>Location: {loc.level === 'city' ? 'city only' : loc.level} · {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)} ± {(loc.radius_m / 1000).toFixed(1)} km
              {loc.evidence.length > 0 && <div className="muted">{loc.evidence.join(' · ')}</div>}
              <LocMap lat={loc.lat} lon={loc.lon} radius_m={loc.radius_m} /></>
              : r.triage.military_object >= 0.5 ? <span className="warn">Location withheld: military object visible</span>
              : <span className="muted">Location: unknown</span>}
          </div>
          <div>Graphic level: {r.triage.graphic_level}</div>
          {r.weapon && <h4>WEAPON INDICATORS</h4>}
          <WeaponBars weapon={r.weapon} />
          <div>
            {r.incident_id ? <>Matched incident #{r.incident_id} </> : <>New incident </>}
            <button disabled={!r.incident_id} onClick={() => { window.location.hash = `#/incident/${r.incident_id}` }}>Open in reconstruction</button>
          </div>
        </>
      )}
    </section>
  )
}
