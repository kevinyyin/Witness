// §7.4 Proof slide: the §11 table with real numbers + the 3 worst misses, from web/public/eval/results.json (§9.3).
import { useEffect, useState } from 'react'
import type { Results } from '../types'
import { getJSON } from '../data/load'
import { SampleBanner } from './SampleBanner'

const fmt = (v: number | null, unit: string) => (v == null ? 'n/a' : `${v}${unit === '%' ? '%' : ` ${unit}`}`)
// Where Witness differs from the baseline comes first; the fake rows tie on easy fakes, so they go last.
const CLAIMS = ['Geolocation works', 'Uncertainty is honest', 'Grouping', 'Fakes caught']
const rank = (claim: string) => (CLAIMS.indexOf(claim) + 1) || CLAIMS.length + 1

export function Proof() {
  const [r, setR] = useState<Results | null | undefined>(undefined)
  useEffect(() => { getJSON<Results>('eval/results.json').then(setR) }, [])
  // eval/changes.json: failures seen on the dev set and what was changed for each. Optional: no file, no section.
  const [changes, setChanges] = useState<{ items: { saw: string; changed: string; now: string; evidence: string }[] } | null>(null)
  useEffect(() => { getJSON<typeof changes>('eval/changes.json').then(setChanges) }, [])
  if (r === undefined) return <div className="page muted">Loading eval/results.json…</div>
  if (r === null) return <div className="page warn">No web/public/eval/results.json yet (the pipeline commits dev-set numbers by 3:00, test-set by 3:50).</div>
  const a = r.ablation, best = Math.max(a.full_video, a.frames_5, a.transcript, 1)
  // results.json lists one row per baseline, not grouped: put each metric's rows together, the agreed baseline (D15) first.
  const first = (x: Results['rows'][number]) => r.rows.findIndex((y) => y.claim === x.claim && y.metric === x.metric)
  const d15 = (x: Results['rows'][number]) => (x.baseline_name?.startsWith('Claude') ? 0 : 1)
  const rows = [...r.rows].sort((x, y) => rank(x.claim) - rank(y.claim) || first(x) - first(y) || d15(x) - d15(y))
  return (
    <div className="page proof">
      <SampleBanner show={r.split !== 'test'} text="DEV NUMBERS, NOT FINAL" />
      <h1>Proof<i>.</i></h1>
      <p className="meta">{r.split} set · {r.n_clips} clips{r.frozen_at ? ` · frozen ${r.frozen_at}` : ''} · scored against Bellingcat / GeoConfirmed answer keys</p>
      <table>
        <thead><tr><th>Claim</th><th>Metric</th><th>Witness</th><th>Baseline</th><th>n</th></tr></thead>
        <tbody>
          {rows.map((x, i) => {
            const same = i > 0 && rows[i - 1].claim === x.claim && rows[i - 1].metric === x.metric // one row per baseline: name the metric once
            return (
            <tr key={i} className={same ? 'cont' : ''}>
              <td>{same ? '' : x.claim}</td><td className="muted">{same ? '' : x.metric}</td>
              <td className="num">{fmt(x.witness, x.unit)}</td>
              <td className="num">{fmt(x.baseline, x.unit)}{x.baseline_name && <div className="muted small">{x.baseline_name}</div>}</td>
              <td className="n">{x.n}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
      {changes && changes.items.length > 0 && (
        <>
          <h3>What we changed after seeing failures</h3>
          <table className="changes">
            <thead><tr><th>What we saw</th><th>What we changed</th><th>Result</th></tr></thead>
            <tbody>
              {changes.items.map((c, i) => (
                <tr key={i}><td>{c.saw}</td><td>{c.changed}</td><td>{c.now}<div className="muted small">{c.evidence}</div></td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Footage, not a description of it <span className="muted">· {a.metric} · n = {a.n}</span></h3>
      {([['full video', a.full_video], ['5 frames', a.frames_5], ['transcript', a.transcript]] as const).map(([k, v]) => (
        <div key={k} className="bar-row wide"><span>{k}</span><span className="bar"><span style={{ width: `${(v / best) * 100}%` }} /></span><span>{fmt(v, a.unit)}</span></div>
      ))}
      <h3>Worst misses</h3>
      <div className="misses">
        {r.worst_misses.map((m) => (
          <div key={m.clip_id} className="miss">
            {m.thumb ? <img src={`${import.meta.env.BASE_URL}${m.thumb}`} alt="" /> : <div className="no-thumb muted">no thumbnail</div>}
            <div><b>{m.clip_id}</b></div>
            <div>expected: {m.expected}</div>
            <div className="warn">got: {m.got}</div>
            <div className="muted">{m.why}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
