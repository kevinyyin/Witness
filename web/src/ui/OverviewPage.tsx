import { useEffect, useState } from 'react'
import type { IncidentIndex } from '../types'
import { loadIndex } from '../data/load'
import { SampleBanner } from './SampleBanner'

/** V0 stub: incident list. The dot map (§7.3) replaces it in V5. */
export function OverviewPage() {
  const [index, setIndex] = useState<IncidentIndex | null>(null)
  useEffect(() => { loadIndex().then(setIndex) }, [])
  if (!index) return <div className="page muted">Loading incidents…</div>
  return (
    <div className="page">
      <SampleBanner show={index.is_sample} />
      <h2>Incidents</h2>
      {index.incidents.length === 0 && <p className="warn">No incidents (incidents/index.json and sample_index.json both missing).</p>}
      <ul>
        {index.incidents.map((e) => (
          <li key={e.id}><a href={`#/incident/${e.id}`}>{e.city} · #{e.id} · {e.title}</a></li>
        ))}
      </ul>
    </div>
  )
}
