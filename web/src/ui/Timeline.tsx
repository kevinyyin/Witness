// §7.1.6 timeline: the reviewer's main control. Rows: flags, events, one lane per clip. Drives t.
import { useEffect, useMemo, useRef } from 'react'
import type { Incident } from '../types'
import type { Ruler } from '../time/ruler'
import { useTime } from '../time/store'
import { anchorSource, fmtT, laneOf, mmss } from '../time/derive'

type Mark = { t: number; row: 'flag' | 'note' | 'event'; text: string; tip: string; src?: string }

function marksOf(inc: Incident): Mark[] {
  const c = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2))
  return [
    ...inc.flags.filter((f) => f.t != null).map((f) => ({ t: f.t!, row: 'flag' as const, text: '▲', src: anchorSource(f.anchor), tip: `${f.label}\n${f.basis.join(' · ')}\nconf ${c(f.confidence)}` })),
    ...inc.review_notes.filter((f) => f.t != null).map((f) => ({ t: f.t!, row: 'note' as const, text: '●', src: anchorSource(f.anchor), tip: `${f.label}\n${f.basis.join(' · ')}\nconf ${c(f.confidence)}` })),
    ...inc.timeline.map((e) => ({
      t: e.t, row: 'event' as const, src: e.source,
      text: e.type === 'impact' ? '✦' : e.type === 'boom_heard' ? `boom@${e.source}` : e.type.replace(/_/g, ' '),
      tip: `${e.type} ${fmtT(e.t)}\n${e.source ?? ''}${e.clip_ts != null ? `@${mmss(e.clip_ts)}` : ''}\nconf ${c(e.confidence)}`,
    })),
  ].sort((a, b) => a.t - b.t)
}

function niceStep(span: number) {
  return [1, 2, 5, 10, 30, 60, 120, 300, 600].find((s) => span / s <= 12) ?? 1200
}

function Playhead({ ruler }: { ruler: Ruler }) {
  const t = useTime((s) => s.t)
  return <div className="playhead" style={{ left: `${ruler.tToX(t) * 100}%` }} />
}

function Readout() {
  const t = useTime((s) => Math.round(s.t * 10) / 10)
  return <span className="readout">t = {fmtT(t)}</span>
}

export function Timeline({ inc, ruler }: { inc: Incident; ruler: Ruler }) {
  const playing = useTime((s) => s.playing), speed = useTime((s) => s.speed), mode = useTime((s) => s.mode)
  const { toggle, setSpeed, setMode, setT, jump } = useTime.getState()
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const marks = useMemo(() => marksOf(inc), [inc])
  const x = (t: number) => `${ruler.tToX(t) * 100}%`
  const scrub = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    setT(ruler.xToT((clientX - r.left) / r.width))
  }
  const ticks = useMemo(() => {
    const linear = ruler.end - ruler.start - ruler.gaps.reduce((s, g) => s + g.t1 - g.t0, 0)
    const step = niceStep(linear), out: number[] = []
    for (let t = Math.ceil(ruler.start / step) * step; t <= ruler.end; t += step)
      if (!ruler.gaps.some((g) => t > g.t0 && t < g.t1)) out.push(t)
    return out
  }, [ruler])

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

  const checkedNone = inc.flags.filter((f) => f.t == null && f.status === 'checked_none')
  return (
    <div className="timeline">
      <div className="tl-controls">
        <button onClick={toggle}>{playing ? '❚❚' : '▶'}</button>
        {[0.25, 1, 4].map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}x</button>)}
        <span className="seg">
          <button className={mode === 'walk' ? 'on' : ''} onClick={() => setMode('walk')}>Walkthrough{mode === 'walk' ? ' ●' : ''}</button>
          <button className={mode === 'free' ? 'on' : ''} onClick={() => setMode('free')}>Free</button>
        </span>
        {mode === 'free' && <button onClick={() => setMode('walk')}>Resume walkthrough</button>}
        <Readout />
        {checkedNone.length > 0 && <span className="muted checked">○ checked, none: {checkedNone.map((f) => f.label).join(' · ')}</span>}
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <div>flags</div><div>events</div>
          {inc.sources.map((s) => <div key={s.id}>{s.id}</div>)}
        </div>
        <div className="tl-track" ref={track}
          onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); scrub(e.clientX) }}
          onPointerMove={(e) => dragging.current && scrub(e.clientX)}
          onPointerUp={() => { dragging.current = false }}>
          {ticks.map((t) => <div key={t} className="tick" style={{ left: x(t) }}>{t > 0 ? '+' : ''}{t}s</div>)}
          {ruler.gaps.map((g, i) => (
            <div key={i} className="gap" style={{ left: x(g.t0), width: `${(ruler.tToX(g.t1) - ruler.tToX(g.t0)) * 100}%` }}>
              ⋯ {Math.round((g.t1 - g.t0) / 60)} min ⋯
            </div>
          ))}
          {marks.map((m, i) => (
            <div key={i} className={`mark ${m.row}`} style={{ left: x(m.t) }} title={m.tip}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => jump(m.t - 2, m.src ?? null)}>{m.text}</div>
          ))}
          {inc.sources.map((s, i) => {
            const l = laneOf(inc, s)
            const boom = inc.timeline.find((e) => e.type === 'boom_heard' && e.source === s.id)
            return (
              <div key={s.id} className="lane-row" style={{ top: 40 + i * 16 }}>
                {l ? (
                  <div className={`lane ${s.aligned === false ? 'approx' : ''} ${l.guessed ? 'guessed' : ''}`}
                    style={{ left: x(l.t0), width: `${(ruler.tToX(l.t1) - ruler.tToX(l.t0)) * 100}%` }}>
                    {s.aligned === false && 'approx.'}
                  </div>
                ) : <span className="muted lane-note">not aligned</span>}
                {boom && <span className="boom-tag" style={{ left: x(boom.t) }}>boom heard {fmtT(boom.t)}</span>}
              </div>
            )
          })}
          <Playhead ruler={ruler} />
        </div>
      </div>
    </div>
  )
}
