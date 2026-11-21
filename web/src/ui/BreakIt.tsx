// §7.2 Break-it panel: a judge pastes a YouTube link or drops a video; stages tick live; verdict with reasons;
// "What was it really?" feeds a scoreboard where wrong answers stay. Offline → replay the recorded fixtures.
import { useEffect, useRef, useState } from 'react'
import type { ClipRecord } from '../types'
import type { StageEvent, StageName, StreamEvent } from '../breakit/sse'
import { analyze, health, judge, replayFixture, scoreboard, type Fixture, type Health, type Scoreboard, type Truth } from '../breakit/api'
import { mmss } from '../time/derive'
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
  const started = useRef(0)

  useEffect(() => { health().then(setH); scoreboard().then(setBoard) }, [])
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setElapsed((performance.now() - started.current) / 1000), 200)
    return () => clearInterval(id)
  }, [busy])

  const offline = h === null
  const onEvent = (e: StreamEvent) => {
    if (e.event === 'stage') setStages((s) => ({ ...s, [e.data.stage]: e.data }))
    else if (e.event === 'result') setResult(e.data as ClipRecord)
    else setError(`${e.data.stage}: ${e.data.message}`)
  }
  const run = async (go: () => Promise<void>) => {
    setStages({}); setResult(null); setError(null); setJudged(false); setBusy(true)
    started.current = performance.now(); setElapsed(0)
    try { await go() } catch (err) { setError(String((err as Error).message ?? err)) } finally { setBusy(false) }
  }
  const submit = () => run(() => analyze(file ? { file, claimed_place: place || null } : { url: url.trim(), claimed_place: place || null }, onEvent))
  const replay = (f: Fixture) => run(() => replayFixture(f, onEvent))
  const tell = async (truth: Truth) => {
    if (!result) return
    try { setBoard(await judge(result.clip_id, truth)); setJudged(true) } catch (err) { setError(String((err as Error).message)) }
  }

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
            ? <input placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => { setUrl(e.target.value); setFile(null) }} />
            : <div className="muted">YouTube links are off for this run (K1); drop a video file instead.</div>}
          <label className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setUrl('') } }}>
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
        {result && <Verdict r={result} />}
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

function Verdict({ r }: { r: ClipRecord }) {
  const f = r.fake
  const rejected = f.verdict === 'fake'
  const title = rejected ? `Rejected · ${LABEL[f.label ?? ''] ?? f.label ?? 'not real'}` : f.verdict === 'real' ? 'Real strike footage' : 'Unsure'
  const loc = r.location
  return (
    <section className={`verdict ${f.verdict}`}>
      <h3>{title} <span className="muted">conf {f.confidence.toFixed(2)}</span></h3>
      {f.checks.map((c) => (
        <div key={c.name} className={`check ${c.result === 'fail' ? 'fail' : ''}`}>
          {c.result === 'pass' ? '✓' : c.result === 'fail' ? '✗' : '–'} {c.name.replace(/_/g, ' ')}: {c.detail}{c.clip_ts != null && <span className="muted"> @ {mmss(c.clip_ts)}</span>}
        </div>
      ))}
      {!rejected && (
        <>
          <div className="bk-loc">
            {loc ? <>Location: {loc.level === 'city' ? 'city only' : loc.level} · {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)} ± {(loc.radius_m / 1000).toFixed(1)} km
              {loc.evidence.length > 0 && <div className="muted">{loc.evidence.join(' · ')}</div>}</>
              : r.triage.military_object >= 0.5 ? <span className="warn">Location withheld: military object visible</span>
              : <span className="muted">Location: unknown</span>}
          </div>
          <div>Graphic level: {r.triage.graphic_level}</div>
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
