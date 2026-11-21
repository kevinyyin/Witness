import { useEffect, useState } from 'react'
import type { IncidentIndex } from '../types'
import { loadIndex } from '../data/load'
import { SampleBanner } from './SampleBanner'

/** V0 stub: incident list from incidents/index.json (§9.3). The dot map (§7.3) replaces it in V5. */
export function OverviewPage() {
  const [index, setIndex] = useState<IncidentIndex | null | undefined>(undefined)
  useEffect(() => { loadIndex().then(setIndex) }, [])
  if (index === undefined) return <div className="page muted">Loading incidents…</div>
  if (index === null) return <div className="page warn">No incidents/index.json and no sample_index.json.</div>
  return (
    <div className="page">
      <SampleBanner show={index.is_sample} />
      <h2>{index.city} · {index.n_clips} clips → {index.incidents.length} incidents</h2>
      <ul>
        {index.incidents.map((e) => (
          <li key={e.id}><a href={`#/incident/${e.id}`}>#{e.id} · {e.title}</a> <span className="muted">· {e.n_sources} sources · {e.corroboration}</span></li>
        ))}
      </ul>
    </div>
  )
}
