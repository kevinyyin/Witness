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

// name + what the step does, in a judge's words: the rail explains the run before it starts and tracks it once it does
const STAGES: [StageName, string, string][] = [
  ['fetch', 'Fetch', 'Reads the video. Past 3 minutes, only the first 3 are used.'],
  ['watch', 'Watch and listen', 'Hydrogen lists everything seen and heard, with times: flashes, blasts, sirens, speech.'],
  ['physics', 'Physics checks', 'Sound travels 343 m/s. Does the boom arrive when it should? Is one blast sound reused?'],
  ['score', 'Score', 'The Decisions API scores how likely this is war footage, a game, a movie or fireworks.'],
  ['locate', 'Locate', 'Real footage only: where it was filmed, with an honest margin of error.'],
  ['verdict', 'Verdict', 'Real, rejected or unsure, with every reason listed.'],
]
const TRUTHS: [Truth, string][] = [
  ['real_strike', 'Real strike'], ['video_game', 'Game'], ['movie', 'Movie'], ['fireworks_demolition', 'Fireworks or demolition'], ['other', 'Other'],
]
const LABEL: Record<string, string> = { video_game: 'video game', not_war: 'not war', real_strike: 'real strike' }
const SAID: Record<string, string> = { fake: 'rejected', real: 'real', unsure: 'unsure' }

const PATHS = { pass: 'M3 8.5l3.2 3.2L13 4.5', fail: 'M4 4l8 8M12 4l-8 8', error: 'M4 4l8 8M12 4l-8 8', 'n/a': 'M4 8h8', play: 'M5 3v10l8-5z' }
const Icon = ({ name }: { name: keyof typeof PATHS }) => <svg className={name === 'play' ? 'ico fill' : 'ico'} viewBox="0 0 16 16" aria-hidden="true"><path d={PATHS[name]} /></svg>

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
  const [judged, setJudged] = useState<{ truth: Truth; right: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  // what this run was given: its video shows the moment Analyze is pressed, so nobody waits on a list of stage names
  const [sent, setSent] = useState<{ n: number; yt: string | null; file: File | null } | null>(null)
  const adapter = useRef<Adapter | null>(null)
  const started = useRef(0)
  const rail = useRef<HTMLElement>(null)
  const ended = useRef(false) // a result or an error arrived: anything else is a dropped stream

  useEffect(() => { health().then(setH); scoreboard().then(setBoard) }, [])
  useEffect(() => { // a file dropped anywhere on the page is taken; without this a near miss makes the browser open the file
    const over = (e: DragEvent) => { e.preventDefault(); setDragging(true) }
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false) } // left the window, not just one element
    const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files[0]; if (f) { setFile(f); setUrl('') } }
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop) }
  }, [])
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setElapsed((performance.now() - started.current) / 1000), 200)
    return () => clearInterval(id)
  }, [busy])

  // the steps and the verdict fit one screen once the intro is scrolled away (an effect: the page is only tall enough after the workspace renders)
  useEffect(() => { if (busy) rail.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [busy])

  const offline = h === null
  const onEvent = (e: StreamEvent) => {
    if (e.event === 'stage') setStages((s) => ({ ...s, [e.data.stage]: e.data }))
    else if (e.event === 'result') { ended.current = true; setResult(e.data as ClipRecord) }
    else { ended.current = true; setError(`${e.data.stage}: ${e.data.message}`) }
  }
  const run = async (go: () => Promise<void>) => {
    setStages({}); setResult(null); setError(null); setJudged(null); setBusy(true)
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
    try { const b = await judge(result.clip_id, truth); setBoard(b); setJudged({ truth, right: !!b.history[b.history.length - 1]?.right }) } catch (err) { setError(String((err as Error).message)) }
  }

  const yt = sent && !sent.file ? (youtubeId(result?.embed_url ?? '') ?? sent.yt) : null
  const playable = !!sent && (!!yt || !!sent.file)
  const go = (ts: number) => { adapter.current?.seek(Math.max(0, ts - 1.5)); adapter.current?.play() } // start just before the moment

  const ready = !busy && (!!file || !!url.trim())

  return (
    <div className={`page breakit${dragging ? ' dragging' : ''}`}>
      <SampleBanner show={offline} />
      <header className="bk-head">
        <div>
          <h1>Try to fool Witness<i>.</i></h1>
          <p className="bk-lede">Give it any video of an explosion: real war footage, a video game, a movie, fireworks. Within a minute it says whether the clip shows a real strike and lists its evidence. Then you say what it really was, and the result goes on the board.</p>
        </div>
        {board && (
          <aside className="bk-tally" aria-label="Scoreboard">
            <h2>Scoreboard</h2>
            <p className="n" aria-label={`Witness right ${board.right} of ${board.tries}`}>{board.right}<span>/ {board.tries}</span></p>
            <p>{board.tries === 0 ? 'No attempts yet.' : 'Verdicts Witness got right, of all a judge has marked.'} Wrong answers stay on the board.</p>
          </aside>
        )}
      </header>

      {h === undefined && <p className="muted">Checking the pipeline server…</p>}
      {offline && (
        <div className="bk-offline">
          <p>The pipeline server is not reachable, so nothing can be analyzed live. Replay a recorded run instead:</p>
          <button onClick={() => replay('analyze_fake')} disabled={busy}>Replay a rejected clip</button>
          <button onClick={() => replay('analyze_real')} disabled={busy}>Replay a real strike</button>
        </div>
      )}
      {h && (
        <form className="bk-form" onSubmit={(e) => { e.preventDefault(); if (ready) submit() }}>
          <div className="bk-main">
            {file
              ? <div className="bk-file"><Icon name="play" /><span>{file.name}</span><button type="button" onClick={() => setFile(null)}>Remove</button></div>
              : h.youtube_url_input
                ? <input aria-label="YouTube link" inputMode="url" required placeholder="Paste a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} />
                : <div className="bk-file"><span>YouTube links are off for this run. Choose a video file instead.</span></div>}
            <button className="bk-go" disabled={busy || (!file && !h.youtube_url_input)}>{busy ? 'Analyzing…' : 'Analyze'}</button>
          </div>
          <div className="bk-sub">
            <label className="bk-pick">
              <input type="file" accept="video/*,.webm,.mkv" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setUrl('') }; e.target.value = '' }} />
              <span>Choose a video file</span> or drop one anywhere on this page. Any format.
            </label>
            <label className="bk-place">
              <span>Claimed place <i>optional</i></span>
              <input placeholder="e.g. Kharkiv" value={place} onChange={(e) => setPlace(e.target.value)} />
              <small>Where the post says it was filmed. Witness starts locating from there.</small>
            </label>
          </div>
        </form>
      )}

      <section className="bk-rail" ref={rail}>
        <div className="bk-rail-head">
          <h2 role="status">{busy ? 'Witness is watching' : result ? 'Finished' : error ? 'Stopped' : 'What happens when you press Analyze'}</h2>
          {(busy || result) && <span className="bk-clock">{elapsed.toFixed(1)} s</span>}
        </div>
        {/* the spec's promise, drawn: a verdict inside 60 s. The red line is this run's elapsed time. */}
        <div className="bk-budget" aria-hidden="true">
          <i style={{ transform: `scaleX(${Math.min(elapsed / 60, 1)})` }} />
          <span>0 s</span><span>15</span><span>30</span><span>45</span><span>60 s target</span>
        </div>
        <ol>
          {STAGES.map(([k, name, what], i) => {
            const s = stages[k], st = s?.status ?? 'pending'
            return (
              <li key={k} className={st}>
                <p className="k"><span>0{i + 1}</span>{st === 'start' ? 'running' : st === 'done' ? `${((s?.ms ?? 0) / 1000).toFixed(1)} s` : st === 'pending' ? '' : st === 'error' ? 'failed' : st}<i /></p>
                <h3>{name}</h3>
                <p className="what">{what}</p>
                {s?.summary && <p className="out">{s.summary}</p>}
              </li>
            )
          })}
        </ol>
        {error && <p className="bk-error" role="alert"><Icon name="error" />{error}</p>}
      </section>

      {(busy || playable || result) && (
        <div className="bk-work">
          <div className="bk-left">
            {playable && <ClipPlayer key={sent!.n} yt={yt} file={sent!.file} graphic={result?.triage.graphic_level ?? 0} adapter={adapter} />}
            {result && result.timeline.length > 0 && (
              <section className="bk-seen">
                <h3>Seen and heard by Hydrogen{playable && <span> · click a line to play it</span>}</h3>
                <ol>
                  {result.timeline.map((e, i) => (
                    <li key={i}><button disabled={!playable} onClick={() => go(e.clip_ts)}><span className="t">{mmss(e.clip_ts)}</span>{e.label}</button></li>
                  ))}
                </ol>
              </section>
            )}
          </div>
          <div className="bk-right">
            {result
              ? <Verdict key={result.clip_id} r={result} playable={playable} go={go} />
              : <div className="bk-wait"><h3>Verdict pending</h3><p>Play the clip while Witness works. The verdict lands here, with every reason listed.</p></div>}
            {result && (
              <section className="bk-judge">
                <h3>{judged ? `Logged. Witness got this one ${judged.right ? 'right' : 'wrong'}.` : 'Was Witness right? Say what the clip really was.'}</h3>
                <div>
                  {TRUTHS.map(([t, label]) => <button key={t} className={judged?.truth === t ? 'on' : ''} disabled={offline || !!judged} onClick={() => tell(t)}>{label}</button>)}
                </div>
                {offline && <p className="muted">Replays are not scored: the scoreboard lives on the pipeline server.</p>}
              </section>
            )}
          </div>
        </div>
      )}

      {board && board.history.length > 0 && (
        <section className="bk-log">
          <h2>Every attempt <span>newest first · an "unsure" never counts as right</span></h2>
          <table>
            <thead><tr><th>Clip</th><th>Witness said</th><th>Judge said</th><th>Result</th></tr></thead>
            <tbody>
              {[...board.history].reverse().map((x, i) => (
                <tr key={i} className={x.right ? 'ok' : 'wrong'}>
                  <td className="id">{x.clip_id}</td>
                  <td>{SAID[x.verdict] ?? x.verdict}{x.label && x.verdict === 'fake' ? `: ${LABEL[x.label] ?? x.label.replace(/_/g, ' ')}` : ''}</td>
                  <td>{x.truth.replace(/_/g, ' ')}</td>
                  <td className="res"><Icon name={x.right ? 'pass' : 'fail'} />{x.right ? 'Right' : 'Wrong'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

/** The map is the centre of a located verdict: OpenStreetMap's own embed, a red marker on the best guess and a red
 *  circle for the uncertainty radius. The embed fits its box at a whole zoom level, so the circle is sized from
 *  that same zoom (Web Mercator: metres per pixel = 156543.03 · cos(lat) / 2^zoom). */
function LocMap({ lat, lon, radius_m, title, sub }: { lat: number; lon: number; radius_m: number; title: string; sub: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  useEffect(() => {
    const measure = () => box.current && setSize([box.current.clientWidth, box.current.clientHeight])
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const rad = Math.PI / 180
  const dLat = (Math.max(radius_m, 150) * 1.6) / 111_320, dLon = dLat / Math.cos(lat * rad)
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((x) => x.toFixed(5)).join(',')
  const mercY = (d: number) => (1 - Math.log(Math.tan(d * rad) + 1 / Math.cos(d * rad)) / Math.PI) / 2
  let ring = 0
  if (size) {
    const zoom = Math.min(19, Math.floor(Math.log2(Math.min(
      size[0] / (256 * ((2 * dLon) / 360)), size[1] / (256 * (mercY(lat - dLat) - mercY(lat + dLat)))))))
    ring = (2 * radius_m) / ((156543.03392 * Math.cos(lat * rad)) / 2 ** zoom)
  }
  return (
    <div className="bk-map" ref={box}>
      <iframe title="Estimated location on OpenStreetMap" loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`} />
      {ring > 0 && <i className="ring" style={{ width: ring, height: ring }} />}
      <i className="pin" />
      <div className="where"><b>{title}</b>{sub && <span>{sub}</span>}</div>
    </div>
  )
}

function Verdict({ r, playable, go }: { r: ClipRecord; playable: boolean; go: (ts: number) => void }) {
  const f = r.fake
  const rejected = f.verdict === 'fake'
  const title = rejected ? `Rejected · ${LABEL[f.label ?? ''] ?? f.label?.replace(/_/g, ' ') ?? 'not real'}` : f.verdict === 'real' ? 'Real strike footage' : 'Unsure · needs a human reviewer'
  const loc = r.location
  return (
    <section className={`verdict ${f.verdict}`}>
      <header>
        <h2>{title}</h2>
        <span>confidence {f.confidence.toFixed(2)}</span>
      </header>
      {rejected && <p className="note">Rejected clips are not located and never reach the map.</p>}
      {!rejected && (loc ? (
        <div className="bk-loc">
          <LocMap lat={loc.lat} lon={loc.lon} radius_m={loc.radius_m}
            title={`${loc.level === 'city' ? 'City only' : loc.level === 'unknown' ? 'Location unknown' : loc.level} · ± ${loc.radius_m >= 1000 ? `${(loc.radius_m / 1000).toFixed(1)} km` : `${loc.radius_m} m`}`}
            sub={loc.evidence[0] ?? ''} />
          <p className="coords">
            {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)} · {loc.method} · {loc.candidates} candidate{loc.candidates === 1 ? '' : 's'}
            {' · '}{f.checks.filter((c) => c.result === 'pass').length} of {f.checks.filter((c) => c.result !== 'n/a').length} checks passed
            {' · '}{Math.round(Object.values(r.stages_ms).reduce((a: number, b) => a + (b ?? 0), 0) / 1000)} s
          </p>
        </div>
      ) : (
        <div className="bk-loc">
          {r.triage.military_object >= 0.5 ? <p className="warn">Location withheld: military object visible</p> : <p className="muted">Location unknown</p>}
        </div>
      ))}
      <h3>The checks</h3>
      <ul className="checks">
        {f.checks.map((c) => (
          <li key={c.name} className={c.result === 'n/a' ? 'na' : c.result}>
            <Icon name={c.result} />
            <b>{c.name.replace(/_/g, ' ')}</b>
            <span>{c.detail}{c.clip_ts != null && (playable
              ? <button className="jump" onClick={() => go(c.clip_ts!)}><Icon name="play" />{mmss(c.clip_ts)}</button>
              : <span className="t"> at {mmss(c.clip_ts)}</span>)}</span>
          </li>
        ))}
      </ul>
      {!rejected && (
        <>
          {r.weapon && <h3>Weapon indicators</h3>}
          <WeaponBars weapon={r.weapon} />
          <div className="bk-foot">
            <span>Graphic level {r.triage.graphic_level}</span>
            <span>{r.incident_id ? `Matched incident #${r.incident_id}` : 'New incident'}</span>
            <button disabled={!r.incident_id} onClick={() => { window.location.hash = `#/incident/${r.incident_id}` }}>Open in reconstruction</button>
          </div>
        </>
      )}
    </section>
  )
}
