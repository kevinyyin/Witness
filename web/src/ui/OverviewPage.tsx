// §7.3 Overview: dark 2D map of the city, one dot per incident (size = sources, colour = corroboration),
// a "rejected: N" tray and "N clips → M incidents" from incidents/index.json (§9.3). No tiles: venue wifi is flaky.
import { useEffect, useState } from 'react'
import type { IncidentIndex } from '../types'
import { loadIndex } from '../data/load'
import { toLocal } from '../scene/geo'
import { SampleBanner } from './SampleBanner'

const COLOR: Record<string, string> = { high: 'var(--green)', medium: 'var(--amber)', low: 'var(--red)' }
const W = 900, H = 560, PAD = 60

export function OverviewPage() {
  const [index, setIndex] = useState<IncidentIndex | null | undefined>(undefined)
  useEffect(() => { loadIndex().then(setIndex) }, [])
  if (index === undefined) return <div className="page muted">Loading incidents…</div>
  if (index === null) return <div className="page warn">No incidents/index.json and no sample_index.json.</div>

  const inc = index.incidents
  const o = { lat: inc.reduce((s, e) => s + e.lat, 0) / Math.max(1, inc.length), lon: inc.reduce((s, e) => s + e.lon, 0) / Math.max(1, inc.length) }
  const xy = inc.map((e) => toLocal(o, e.lat, e.lon))
  const span = Math.max(2000, ...xy.map(([x, z]) => 2 * Math.max(Math.abs(x), Math.abs(z)))) // metres across, ≥ 2 km
  const k = Math.min(W, H) / span * ((Math.min(W, H) - 2 * PAD) / Math.min(W, H))
  const km = span > 8000 ? 5 : 1
  return (
    <div className="page overview">
      <SampleBanner show={index.is_sample} />
      <h2>{index.city.toUpperCase()} · {index.n_clips} clips → {inc.length} incident{inc.length === 1 ? '' : 's'} <span className="tray">rejected: {index.n_rejected}</span></h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="dotmap">
        <rect width={W} height={H} fill="#05080b" />
        {xy.map(([x, z], i) => {
          const e = inc[i], cx = W / 2 + x * k, cy = H / 2 + z * k
          return (
            <a key={e.id} href={`#/incident/${e.id}`}>
              <circle cx={cx} cy={cy} r={Math.max(e.radius_m * k, 1)} fill="none" stroke={COLOR[e.corroboration] ?? 'var(--dim)'} strokeOpacity={0.4} />
              <circle cx={cx} cy={cy} r={6 + 3 * Math.sqrt(e.n_sources)} fill={COLOR[e.corroboration] ?? 'var(--dim)'} fillOpacity={0.85}>
                <title>{`#${e.id} · ${e.title}\n${e.n_sources} sources · corroboration ${e.corroboration}\n±${e.radius_m} m · ${e.impact_local}`}</title>
              </circle>
              <text x={cx + 14} y={cy + 4} fill="var(--text)" fontSize="12">#{e.id}</text>
            </a>
          )
        })}
        <line x1={20} y1={H - 20} x2={20 + km * 1000 * k} y2={H - 20} stroke="var(--dim)" />
        <text x={20} y={H - 26} fill="var(--dim)" fontSize="11">{km} km</text>
      </svg>
      <ul>
        {inc.map((e) => (
          <li key={e.id}><a href={`#/incident/${e.id}`}>#{e.id} · {e.title}</a> <span className="muted">· {e.n_sources} sources · {e.corroboration} · ±{e.radius_m} m</span></li>
        ))}
      </ul>
    </div>
  )
}
