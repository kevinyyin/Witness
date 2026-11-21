// §7.4 Proof slide: the §11 table with real numbers + the 3 worst misses, from web/public/eval/results.json (§9.3).
import { useEffect, useState } from 'react'
import type { Results } from '../types'
import { getJSON } from '../data/load'
import { SampleBanner } from './SampleBanner'

const fmt = (v: number | null, unit: string) => (v == null ? 'n/a' : `${v}${unit === '%' ? '%' : ` ${unit}`}`)

export function Proof() {
  const [r, setR] = useState<Results | null | undefined>(undefined)
  useEffect(() => { getJSON<Results>('eval/results.json').then(setR) }, [])
  if (r === undefined) return <div className="page muted">Loading eval/results.json…</div>
  if (r === null) return <div className="page warn">No web/public/eval/results.json yet (the pipeline commits dev-set numbers by 3:00, test-set by 3:50).</div>
  const a = r.ablation, best = Math.max(a.full_video, a.frames_5, a.transcript, 1)
  return (
    <div className="page proof">
      <SampleBanner show={r.split !== 'test'} text="DEV NUMBERS, NOT FINAL" />
      <h2>Proof <span className="muted">· {r.split} set · {r.n_clips} clips{r.frozen_at ? ` · frozen ${r.frozen_at}` : ''} · scored against Bellingcat / GeoConfirmed answer keys</span></h2>
      <table>
        <thead><tr><th>Claim</th><th>Metric</th><th>Witness</th><th>Baseline</th><th>n</th></tr></thead>
        <tbody>
          {r.rows.map((x, i) => {
            const same = i > 0 && r.rows[i - 1].claim === x.claim && r.rows[i - 1].metric === x.metric // one row per baseline: name the metric once
            return (
            <tr key={i} className={same ? 'cont' : ''}>
              <td>{same ? '' : x.claim}</td><td className="muted">{same ? '' : x.metric}</td>
              <td className="num">{fmt(x.witness, x.unit)}</td>
              <td className="num">{fmt(x.baseline, x.unit)}{x.baseline_name && <div className="muted small">{x.baseline_name}</div>}</td>
              <td className="muted">{x.n}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
      <h3>Needs Gemini's ears <span className="muted">· {a.metric} · n = {a.n}</span></h3>
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
