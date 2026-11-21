// Timeline as a single play bar (YouTube-style) with flag, note and impact markers on it. Drives t.
// Hover details go in a reserved line above the bar, so they never cover the scene or the bar.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Incident } from '../types'
import type { Ruler } from '../time/ruler'
import { useTime } from '../time/store'
import { clockAt, fmtT, mmss } from '../time/derive'

// `src` = the clip a click should show (§9.2: flags/notes carry `source`, events carry `source`).
type Mark = { t: number; kind: 'flag' | 'note' | 'impact'; sym: string; label: string; detail: string; src: string | null }

function marksOf(inc: Incident): Mark[] {
  const c = (x: number | null | undefined) => `conf ${x == null ? '—' : x.toFixed(2)}`
  return [
    ...inc.flags.filter((f) => f.t != null).map((f) => ({ t: f.t!, kind: 'flag' as const, sym: '▲', label: f.label, detail: [...f.basis, c(f.confidence)].join(' · '), src: f.source })),
    ...inc.review_notes.filter((f) => f.t != null).map((f) => ({ t: f.t!, kind: 'note' as const, sym: '●', label: f.label, detail: [...f.basis, c(f.confidence)].join(' · '), src: f.source })),
    ...inc.timeline.filter((e) => e.type === 'impact').map((e) => ({ t: e.t, kind: 'impact' as const, sym: '✦', label: 'Impact', detail: [`${e.source}@${mmss(e.clip_ts)}`, c(e.confidence)].join(' · '), src: e.source })),
  ].sort((a, b) => a.t - b.t)
}

function Progress({ ruler }: { ruler: Ruler }) {
  const t = useTime((s) => s.t)
  const x = `${ruler.tToX(t) * 100}%`
  return <><div className="pb-played" style={{ width: x }} /><div className="pb-knob" style={{ left: x }} /></>
}

function Readout({ end }: { end: number }) {
  const t = useTime((s) => Math.round(s.t * 10) / 10)
  return <span className="readout">{fmtT(t)} <span className="muted">/ {fmtT(end)}</span></span>
}

export function Timeline({ inc, ruler }: { inc: Incident; ruler: Ruler }) {
  const playing = useTime((s) => s.playing), speed = useTime((s) => s.speed), mode = useTime((s) => s.mode)
  const { toggle, setSpeed, setMode, setT, jump } = useTime.getState()
  const bar = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [hover, setHover] = useState<{ x: number; text: React.ReactNode } | null>(null)
  const marks = useMemo(() => marksOf(inc), [inc])
  // Markers closer than ~0.6% of the bar (e.g. every flag at t = 0) become one marker with a count.
  const groups = useMemo(() => {
    const rank = { flag: 0, impact: 1, note: 2 }, out: Mark[][] = []
    for (const m of marks) {
      const g = out[out.length - 1]
      if (g && ruler.tToX(m.t) - ruler.tToX(g[0].t) < 0.006) g.push(m); else out.push([m])
    }
    return out.map((g) => g.sort((a, b) => rank[a.kind] - rank[b.kind]))
  }, [marks, ruler])
  const x = (t: number) => `${ruler.tToX(t) * 100}%`
  const ratio = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) }

  useEffect(() => {
    const times = [...new Set(marks.map((m) => m.t))]
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const s = useTime.getState()
      if (e.key === ' ') { e.preventDefault(); s.toggle() }
      else if (e.key === 'ArrowRight') { const n = times.find((t) => t > s.t + 0.05); if (n != null) s.setT(n) }
      else if (e.key === 'ArrowLeft') { const p = [...times].reverse().find((t) => t < s.t - 0.05); if (p != null) s.setT(p) }
      else if (e.key === 'j' || e.key === 'J') s.setSpeed(0.25)
      else if (e.key === 'k' || e.key === 'K') useTime.setState({ playing: false })
      else if (e.key === 'l' || e.key === 'L') s.setSpeed(4)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [marks])

  // Hovering the bar itself previews the time under the pointer (like YouTube's time tooltip).
  const previewAt = (clientX: number) => {
    const r = ratio(clientX), t = ruler.xToT(r)
    const gap = ruler.gaps.find((g) => t > g.t0 && t < g.t1)
    setHover({ x: r, text: gap ? <>⋯ {Math.round((gap.t1 - gap.t0) / 60)} min with no events (skipped)</> : <>{fmtT(t)} · {clockAt(inc, t)}</> })
  }

  return (
    <div className="timeline">
      <div className="pb-info">
        {hover && <span className="pb-tip" style={{ left: `clamp(0px, calc(${hover.x * 100}% - 20%), 40%)` }}>{hover.text}</span>}
      </div>
      <div className="pb" ref={bar}
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); setT(ruler.xToT(ratio(e.clientX))) }}
        onPointerMove={(e) => { if (dragging.current) setT(ruler.xToT(ratio(e.clientX))); previewAt(e.clientX) }}
        onPointerUp={() => { dragging.current = false }}
        onPointerLeave={() => setHover(null)}>
        <div className="pb-track" />
        {ruler.gaps.map((g, i) => <div key={i} className="pb-gap" style={{ left: x(g.t0), width: `${(ruler.tToX(g.t1) - ruler.tToX(g.t0)) * 100}%` }} />)}
        <Progress ruler={ruler} />
        {groups.map((g, i) => (
          <div key={i} className={`pb-mark ${g[0].kind}`} style={{ left: x(g[0].t) }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => {
              e.stopPropagation()
              setHover({ x: ruler.tToX(g[0].t), text: <>{g.length === 1 ? null : <span className="muted">{fmtT(g[0].t)} · {g.length} items: </span>}
                {g.map((m, j) => <span key={j}>{j > 0 && <span className="muted"> | </span>}<b className={m.kind}>{m.sym} {m.label}</b>{g.length === 1 && <span className="muted"> {fmtT(m.t)} · {m.detail}</span>}</span>)}</> })
            }}
            onClick={() => jump(g[0].t - 2, g[0].src)}>{g[0].sym}{g.length > 1 && <sup>{g.length}</sup>}</div>
        ))}
      </div>
      <div className="tl-controls">
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <Readout end={ruler.end} />
        <span className="spacer" />
        {[0.25, 1, 4].map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}x</button>)}
        <span className="seg">
          <button className={mode === 'walk' ? 'on' : ''} onClick={() => setMode('walk')}>Walkthrough</button>
          <button className={mode === 'free' ? 'on' : ''} onClick={() => setMode('free')}>Free</button>
        </span>
      </div>
    </div>
  )
}
