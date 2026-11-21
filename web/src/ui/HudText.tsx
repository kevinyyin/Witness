// Small panels that read t at ≤10 Hz: clock, lower third, Now panel.
import type { Incident } from '../types'
import { useTime } from '../time/store'
import { calloutState, clockAt, fmtT, mmss } from '../time/derive'

const useT10 = () => useTime((s) => Math.round(s.t * 10) / 10)

/** Top-right clock: absolute local time at the playhead, with its ± (§7.1.2). */
export function Clock({ inc }: { inc: Incident }) {
  const t = useT10()
  return <div className="clock">⏱ {clockAt(inc, t)}</div>
}

/** One line for the current event: what, which clip, timestamp, confidence (§7.1.2). */
export function LowerThird({ inc }: { inc: Incident }) {
  const t = useT10()
  const e = [...inc.timeline].reverse().find((x) => x.t <= t && t - x.t < 4)
  if (!e) return null
  return (
    <div className="lower-third">
      {fmtT(e.t)} {e.type.replace(/_/g, ' ').toUpperCase()}
      {e.source && <> · clip {e.source}{e.clip_ts != null && <> at {mmss(e.clip_ts)}</>}</>}
      {' '}· conf {e.confidence?.toFixed(2) ?? '—'}
    </div>
  )
}

/** Flags and review notes active at the playhead (§7.1.7 #2). */
export function NowPanel({ inc }: { inc: Incident }) {
  const t = useT10()
  const active = [...inc.flags.map((f) => ['▲', f] as const), ...inc.review_notes.map((n) => ['●', n] as const)]
    .map(([s, f]) => ({ s, f, st: calloutState(f, t) }))
    .filter((x) => x.st.state === 'full')
  return (
    <section>
      <h4>NOW <span className="muted">(t = {fmtT(t)})</span></h4>
      {active.length === 0 && <div className="muted">—</div>}
      {active.map(({ s, f, st }, i) => (
        <div key={i} style={{ opacity: st.opacity }} className={s === '▲' ? 'now-flag' : 'now-note'}>
          {s} {f.label} <span className="muted">{f.confidence?.toFixed(2) ?? '—'}</span>
        </div>
      ))}
    </section>
  )
}
