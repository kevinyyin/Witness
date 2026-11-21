// §7.3 Overview: map of the city, one dot per incident (size = sources, mark = corroboration: white high, grey medium, red ring low),
// its uncertainty radius as a ring, a "rejected: N" tray and "N clips → M incidents". Click a dot → §7.1.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { IncidentIndex } from '../types'
import { loadIndex } from '../data/load'
import { SampleBanner } from './SampleBanner'

// [fill, stroke]: the same three marks as .dot in style.css
const MARK: Record<string, [string, string]> = { high: ['#fff', '#000'], medium: ['#8a8a8a', '#fff'], low: ['#000', '#ff2d20'] }

export function OverviewPage() {
  const [index, setIndex] = useState<IncidentIndex | null | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { loadIndex().then(setIndex) }, [])

  useEffect(() => {
    if (!index || !box.current || !index.incidents.length) return
    const map = L.map(box.current, { zoomControl: true, attributionControl: true })
    // Standard OSM tiles (no key; light demo use within the OSMF tile policy), darkened in CSS.
    // If the network is down the dots still draw on the dark background.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors (ODbL)', className: 'dark-tiles',
    }).addTo(map)
    for (const e of index.incidents) {
      const [fill, stroke] = MARK[e.corroboration] ?? MARK.medium
      L.circle([e.lat, e.lon], { radius: e.radius_m, color: e.corroboration === 'low' ? stroke : '#fff', weight: 1, opacity: 0.7, fillOpacity: 0.06, interactive: false }).addTo(map)
      L.circleMarker([e.lat, e.lon], { radius: 7 + 3 * Math.sqrt(e.n_sources), color: stroke, weight: 2, fillColor: fill, fillOpacity: 1 })
        .bindTooltip(`#${e.id} · ${e.title}<br>${e.n_sources} sources · corroboration ${e.corroboration} · ±${e.radius_m} m<br>${e.impact_local.replace('T', ' ').slice(0, 16)}`, { direction: 'top' })
        .on('click', () => { window.location.hash = `#/incident/${e.id}` })
        .addTo(map)
    }
    const bounds = L.latLngBounds(index.incidents.map((e) => [e.lat, e.lon] as [number, number])).pad(0.6)
    map.setView(bounds.getCenter(), 13) // never start at zoom 0 if the container had no size yet
    const fit = setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { maxZoom: 15 }) }, 50)
    return () => { clearTimeout(fit); map.remove() }
  }, [index])

  if (index === undefined) return <div className="page muted">Loading incidents…</div>
  if (index === null) return <div className="page warn">No incidents/index.json and no sample_index.json.</div>
  const n = index.incidents.length
  return (
    <div className="page overview">
      <SampleBanner show={index.is_sample} />
      <div>
        <h1>{index.city}<i>.</i></h1>
        <p className="ov-lede">Every dot is one incident, rebuilt from the clips that show it. Open one to see the reconstruction.</p>
        <dl className="ov-stats">
          <div><dt>Clips</dt><dd>{index.n_clips}</dd></div>
          <div><dt>Incident{n === 1 ? '' : 's'}</dt><dd>{n}</dd></div>
          <div className="rej"><dt>Rejected</dt><dd>{index.n_rejected}</dd></div>
        </dl>
        <ul className="ov-list">
          {index.incidents.map((e) => (
            <li key={e.id}>
              <a href={`#/incident/${e.id}`}>
                <span className="k"><i className={`dot ${e.corroboration}`} />#{e.id} · {e.n_sources} sources · {e.corroboration} corroboration · ±{e.radius_m} m</span>
                <b>{e.title}</b>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div ref={box} className="map" />
    </div>
  )
}
