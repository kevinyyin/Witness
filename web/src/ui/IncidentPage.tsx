import { useEffect, useState } from 'react'
import type { Incident } from '../types'
import { loadIncident, loadOsmFor, type OsmPick } from '../data/load'
import { SampleBanner } from './SampleBanner'

/** V0 stub: loads the incident + its OSM extract and reports what it found. The 3D view replaces the body in V1. */
export function IncidentPage({ id }: { id: string }) {
  const [inc, setInc] = useState<Incident | null | undefined>(undefined)
  const [osm, setOsm] = useState<OsmPick | null | undefined>(undefined)

  useEffect(() => {
    loadIncident(id).then((i) => {
      setInc(i)
      if (i) loadOsmFor(i.impact).then(setOsm)
    })
  }, [id])

  if (inc === undefined) return <div className="page muted">Loading incident {id}…</div>
  if (inc === null) return <div className="page warn">Incident {id} not found (incidents/{id}.json).</div>

  return (
    <div className="page">
      <SampleBanner show={inc.is_sample} />
      <h2>{inc.city.toUpperCase()} · INCIDENT #{inc.id} · {inc.sources.length} SOURCES</h2>
      <div>{inc.title}</div>
      <p className="muted">
        {osm === undefined ? 'OSM: loading…'
          : osm === null ? 'OSM: no extract found (web/public/osm/index.json)'
          : <>OSM: {osm.entry.file} · {osm.osm.elements.length} buildings ·{' '}
              {osm.inside
                ? <>impact inside radius ({Math.round(osm.distance_m)} m from centre)</>
                : <span className="warn">impact OUTSIDE the extract ({Math.round(osm.distance_m)} m from centre, radius {osm.entry.radius_m} m)</span>}
            </>}
      </p>
    </div>
  )
}
