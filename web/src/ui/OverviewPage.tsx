// §7.3 Overview: map of the city, one dot per incident (size = sources, colour = corroboration),
// its uncertainty radius as a ring, a "rejected: N" tray and "N clips → M incidents". Click a dot → §7.1.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { IncidentIndex } from '../types'
import { loadIndex } from '../data/load'
import { SampleBanner } from './SampleBanner'

const COLOR: Record<string, string> = { high: '#4dff88', medium: '#ffb02e', low: '#ff4d3d' }

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
      const c = COLOR[e.corroboration] ?? '#6c8591'
      L.circle([e.lat, e.lon], { radius: e.radius_m, color: c, weight: 1, opacity: 0.6, fillOpacity: 0.08, interactive: false }).addTo(map)
      L.circleMarker([e.lat, e.lon], { radius: 7 + 3 * Math.sqrt(e.n_sources), color: '#000', weight: 1, fillColor: c, fillOpacity: 0.9 })
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
      <h2>{index.city.toUpperCase()} · {index.n_clips} clips → {n} incident{n === 1 ? '' : 's'} <span className="tray">rejected: {index.n_rejected}</span></h2>
      <div ref={box} className="map" />
      <ul>
        {index.incidents.map((e) => (
          <li key={e.id}><a href={`#/incident/${e.id}`}>#{e.id} · {e.title}</a> <span className="muted">· {e.n_sources} sources · {e.corroboration} · ±{e.radius_m} m</span></li>
        ))}
      </ul>
    </div>
  )
}
