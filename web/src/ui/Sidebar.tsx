// §7.1.7 sidebar sections 3–7. Every string shown comes from the incident JSON.
import { useEffect, useState } from 'react'
import type { Incident, OsmFile } from '../types'
import { useTime } from '../time/store'
import { anchorSource, fmtT } from '../time/derive'
import { resolveAnchor } from '../scene/anchors'

const conf = (c: number | null | undefined) => (c == null ? '—' : c.toFixed(2))

// §7.1.9: never "war crime", "illegal", "guilty". Carbon's free text is checked before it is shown.
const VERDICT = /\b(war crimes?|illegal|guilty)\b/i

export function Summary({ inc }: { inc: Incident }) {
  if (!inc.summary) return null
  return (
    <section>
      <h4>WHAT PROBABLY HAPPENED</h4>
      {VERDICT.test(inc.summary)
        ? <div className="warn">Summary withheld: its wording breaks the no-verdict rule (§7.1.9).</div>
        : <div>{inc.summary}</div>}
    </section>
  )
}

const WEAPONS: [string, string][] = [
  ['shahed_drone', 'Shahed-type drone'], ['cruise_missile', 'Cruise missile'], ['ballistic_missile', 'Ballistic missile'],
  ['glide_bomb', 'Glide bomb'], ['rocket_cluster', 'Rocket artillery/cluster'], ['tube_artillery', 'Tube artillery'],
  ['fpv_drone', 'FPV drone'], ['unknown', 'Unknown'],
]

/** §7.1.7 #4 + D7: probability bars, "Unclear" when the top option is < 0.5. */
export function WeaponBars({ inc }: { inc: Incident }) {
  const o = inc.weapon?.options
  if (!o) return null
  const top = Math.max(...WEAPONS.map(([k]) => o[k] ?? 0))
  return (
    <section>
      <h4>WEAPON INDICATORS</h4>
      {top < 0.5 && <div className="unclear">Unclear</div>}
      {WEAPONS.map(([k, name]) => (
        <div key={k} className="bar-row">
          <span>{name}</span>
          <span className="bar"><span style={{ width: `${(o[k] ?? 0) * 100}%` }} /></span>
          <span className="muted">{conf(o[k] ?? 0)}</span>
        </div>
      ))}
      {!!inc.weapon?.evidence?.length && <div className="muted why">why: {inc.weapon.evidence.join(' · ')}</div>}
      <div className="muted foot">Weapon ID needs an expert. These are cues, not conclusions.</div>
    </section>
  )
}

/** §7.1.7 #5: every flag and review note in time order (click = jump); checked-none at the bottom. */
export function FlagsList({ inc, osm }: { inc: Incident; osm: OsmFile | null }) {
  const items = [...inc.flags.map((f) => ({ f, s: '▲' })), ...inc.review_notes.map((f) => ({ f, s: '●' }))]
  const timed = items.filter((x) => x.f.t != null).sort((a, b) => a.f.t! - b.f.t!)
  const rest = items.filter((x) => x.f.t == null)
  return (
    <section>
      <h4>ALL FLAGS <span className="muted">(click = jump)</span></h4>
      {timed.map(({ f, s }, i) => {
        const lost = f.anchor && f.anchor.kind !== 'clock' && resolveAnchor(inc, osm, f.anchor) === null
        return (
          <div key={i} className={`flag-row ${s === '▲' ? 'now-flag' : 'now-note'}`}
            onClick={() => useTime.getState().jump(f.t! - 2, anchorSource(f.anchor) ?? null)}>
            <span className="muted">{fmtT(f.t!)}</span> {s} {f.label} <span className="muted">{conf(f.confidence)}{lost && ' · anchor not in scene'}</span>
          </div>
        )
      })}
      {rest.map(({ f }, i) => (
        <div key={i} className="muted">{f.status === 'checked_none' ? '○ checked, none:' : '·'} {f.label}</div>
      ))}
    </section>
  )
}

/** §7.1.7 #6: every clip with status, location confidence and licence; rejected collapsed at the bottom. */
export function Sources({ inc }: { inc: Incident }) {
  const pin = useTime((s) => s.pin)
  const row = (s: Incident['sources'][number]) => (
    <div key={s.id} className="source-row" onClick={() => pin(s.id)} title="Show this clip">
      <b>{s.id}</b> · {s.platform ?? '?'} · {s.uploader ?? '?'} · {s.posted_at?.replace('T', ' ').slice(0, 16) ?? 'post time unknown'}
      <div className="muted">
        <span className={`st-${s.authenticity}`}>{s.authenticity === 'real' ? '✓' : s.authenticity === 'rejected' ? '✗' : '⚠'} {s.authenticity ?? 'unknown'}</span>
        {' · '}{s.camera ? `camera ±${s.camera.radius_m ?? '?'} m` : 'position unknown'}
        {' · '}{s.license ?? 'licence unknown'}
      </div>
    </div>
  )
  const ok = inc.sources.filter((s) => s.authenticity !== 'rejected'), bad = inc.sources.filter((s) => s.authenticity === 'rejected')
  return (
    <section>
      <h4>SOURCES ({inc.sources.length})</h4>
      {ok.map(row)}
      {bad.length > 0 && <details><summary className="muted">✗ rejected ({bad.length})</summary>{bad.map(row)}</details>}
      {!!inc.verification?.n_rejected && bad.length === 0 && <div className="muted">✗ rejected: {inc.verification.n_rejected} (not in this file)</div>}
    </section>
  )
}

/** §7.1.7 #7 + §13.1: evidence report link (if the pipeline exported it) + investigators' location toggle. */
export function Footer({ inc, showKey, toggleKey }: { inc: Incident; showKey: boolean; toggleKey: () => void }) {
  const [report, setReport] = useState(false)
  const url = `incidents/evidence_report_${encodeURIComponent(inc.id)}.html`
  useEffect(() => {
    // The dev server answers missing files with index.html, so check the content, not the status.
    fetch(url).then((r) => r.text()).then((t) => setReport(t.includes('Evidence report'))).catch(() => setReport(false))
  }, [url])
  return (
    <section className="footer">
      Evidence record: {report ? <a href={url} target="_blank" rel="noreferrer">evidence report ↗</a> : <span className="muted">no report exported yet</span>}
      {inc.answer_key && <> · Investigators' location <button className="mini" onClick={toggleKey}>{showKey ? 'hide' : 'reveal'}</button></>}
      <div className="muted">Built around the Berkeley Protocol: originals hashed at capture, every step logged.</div>
    </section>
  )
}
