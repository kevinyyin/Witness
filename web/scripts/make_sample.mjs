// Builds web/public/osm/* (copies of the OSM extracts + index.json) and the SAMPLE incident files.
// Run: npm run make-sample   (reads $WITNESS_DATA/osm, default ../data/osm)
//
// The §9.2 example's coordinates (49.99, 36.33) are 2–6 km from every OSM extract, so the sample's
// geometry is re-centred on Kharkiv_buildings_2024-06-22.json with a real apartments way as the target.
// Text fields follow the §9.2 example. is_sample is true: the UI shows the SAMPLE DATA banner.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, '..')
const dataDir = path.resolve(process.env.WITNESS_DATA ?? path.join(web, '..', 'data'))
const osmSrc = path.join(dataDir, 'osm')
const pub = path.join(web, 'public')
const osmOut = path.join(pub, 'osm')
fs.mkdirSync(osmOut, { recursive: true })

// ---- 1. Copy OSM extracts + index ----
// Extracts store `center` as [lat, lon]; the index uses {lat, lon}.
const toLatLon = (c) => (Array.isArray(c) ? { lat: c[0], lon: c[1] } : c)
const index = []
for (const f of fs.readdirSync(osmSrc).filter((f) => /_buildings_.*\.json$/.test(f)).sort()) {
  const raw = fs.readFileSync(path.join(osmSrc, f), 'utf8')
  const j = JSON.parse(raw)
  fs.writeFileSync(path.join(osmOut, f), raw)
  const center = toLatLon(j.center)
  if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lon)) throw new Error(`${f}: bad center ${JSON.stringify(j.center)}`)
  index.push({ file: f, city: f.split('_buildings_')[0], center, radius_m: j.radius_m })
}
fs.writeFileSync(path.join(osmOut, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`osm: ${index.length} files → public/osm/`)

// ---- 2. Pick the sample target ----
const SAMPLE_OSM = 'Kharkiv_buildings_2024-06-22.json'
const osm = JSON.parse(fs.readFileSync(path.join(osmSrc, SAMPLE_OSM), 'utf8'))
const center = toLatLon(osm.center)
const k = Math.PI / 180
const dist = (a, b) => Math.hypot((b.lon - a.lon) * k * Math.cos(a.lat * k), (b.lat - a.lat) * k) * 6371000
const centroid = (g) => {
  const pts = g.length > 1 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon ? g.slice(0, -1) : g
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length }
}
const candidates = osm.elements
  .filter((e) => e.geometry && ['apartments', 'residential'].includes(e.tags?.building) && Number(e.tags?.['building:levels']) >= 9)
  .map((e) => ({ e, c: centroid(e.geometry) }))
  .sort((a, b) => dist(center, a.c) - dist(center, b.c))
if (!candidates.length) throw new Error('no apartments way with >= 9 levels in ' + SAMPLE_OSM)
const { e: way, c } = candidates[0]
const r6 = (x) => Math.round(x * 1e6) / 1e6
const impact = { lat: r6(c.lat), lon: r6(c.lon) }
const levels = Number(way.tags['building:levels'])
console.log(`target: way/${way.id} building=${way.tags.building} levels=${levels} at ${impact.lat},${impact.lon} (${Math.round(dist(center, c))} m from extract centre)`)

// point at bearing/distance from impact; heading = bearing from that point back to impact
const offset = (bearingDeg, distM) => {
  const b = bearingDeg * k
  return {
    lat: r6(impact.lat + (distM * Math.cos(b)) / 111320),
    lon: r6(impact.lon + (distM * Math.sin(b)) / (111320 * Math.cos(impact.lat * k))),
    heading_deg: (bearingDeg + 180) % 360,
  }
}
const cam = (bearingDeg, distM, fov, radius) => ({ ...offset(bearingDeg, distM), fov_deg: fov, radius_m: radius })

// ---- 3. Sample incident (§9.2 example text, geometry moved) ----
const sample = {
  id: 'sample',
  city: 'Kharkiv',
  title: 'Strike on apartment block, Saltivskyi district',
  time: { impact_local: '2026-03-14T02:41:07+02:00', plus_minus_s: 360, basis: 'earliest post + aligned offsets' },
  impact: { ...impact, radius_m: 40, method: 'evidence_rings', confidence: 0.78 },
  target: {
    osm_id: `way/${way.id}`,
    footprint: way.geometry.map((p) => [p.lon, p.lat]),
    levels,
    osm_tags: { building: way.tags.building },
    visual_basis: ['B@0:12 balconies'],
  },
  weapon: {
    options: { shahed_drone: 0.71, cruise_missile: 0.14, ballistic_missile: 0.06, glide_bomb: 0.0, rocket_cluster: 0.0, tube_artillery: 0.0, fpv_drone: 0.0, unknown: 0.09 },
    evidence: ['A@0:04-0:11 engine buzz', 'C@0:02-0:09 engine buzz'],
  },
  flags: [
    { type: 'residential', label: `Residential building · ${levels} floors`, status: 'raised', confidence: 0.94,
      t: 0.0, t_end: null, anchor: { kind: 'building', ref: `way/${way.id}` }, basis: [`osm:building=${way.tags.building}`, 'B@0:12'] },
    { type: 'night_strike', label: 'Night strike (02:41 local)', status: 'raised', confidence: 0.99,
      t: 0.0, t_end: null, anchor: { kind: 'clock' }, basis: ['time.impact_local'] },
    { type: 'second_strike', label: 'Second strike on responders', status: 'checked_none', confidence: null,
      t: null, t_end: null, anchor: null, basis: [] },
  ],
  review_notes: [
    { type: 'time_conflict', label: 'Clips C and E disagree on time by 40 s', confidence: 0.8,
      t: 41.0, t_end: 45.0, anchor: { kind: 'cameras', ref: ['C', 'E'] }, basis: ['C@0:12 impact', 'E@0:03 smoke already visible'] },
    { type: 'weak_camera_position', label: 'Camera E position uncertain (±350 m)', confidence: 0.6,
      t: -6.0, t_end: null, anchor: { kind: 'camera', ref: 'E' }, basis: ['E camera radius 350 m'] },
    { type: 'graphic_content', label: 'Graphic content in clip D (blurred)', confidence: 0.9,
      t: 1085.0, t_end: null, anchor: { kind: 'camera', ref: 'D' }, basis: ['D@0:10 graphic level 2'] },
  ],
  timeline: [
    { t: -14.0, type: 'siren', source: 'A', clip_ts: 2.1, confidence: 0.9 },
    { t: -9.6, type: 'engine_buzz', source: 'A', clip_ts: 6.6, confidence: 0.8 },
    { t: 0.0, type: 'impact', source: 'C', clip_ts: 12.4, confidence: 0.95 },
    { t: 1.5, type: 'boom_heard', source: 'B', clip_ts: 13.5, confidence: 0.85 },
    { t: 2.0, type: 'boom_heard', source: 'C', clip_ts: 14.4, confidence: 0.9 },
    { t: 3.1, type: 'boom_heard', source: 'A', clip_ts: 19.2, confidence: 0.9 },
    { t: 60.0, type: 'fire', source: 'B', clip_ts: 72.0, confidence: 0.7 },
    { t: 1080.0, type: 'impact', source: 'D', clip_ts: 5.0, confidence: 0.6 },
  ],
  sources: [
    { id: 'A', clip_id: 'c_0187', platform: 'telegram', url: '…', embed_url: '…', uploader: '…',
      posted_at: '2026-03-14T02:44:00+02:00', camera: cam(225, 1063, 70, 60),
      boom_distance_m: 1063, offset_s: -16.2, aligned: true, authenticity: 'real',
      graphic_level: 1, license: 'embed only', findings: [{ clip_ts: 6.6, label: 'engine buzz' }] },
    { id: 'B', clip_id: 'c_0201', platform: 'commons',
      url: 'https://commons.wikimedia.org/wiki/File:Destructions_in_Kharkiv_after_Russian_attack,_2025-04-03_(001).webm',
      embed_url: '/media/videos/Kharkiv/Destructions_in_Kharkiv_after_Russian_attack_2025-04-03_001_.webm',
      uploader: 'State Emergency Service of Ukraine', posted_at: '2026-03-14T03:10:00+02:00', camera: cam(120, 515, 60, 40),
      boom_distance_m: 515, offset_s: -12.0, aligned: true, authenticity: 'real',
      graphic_level: 1, license: 'CC BY 4.0 · dsns.gov.ua', findings: [{ clip_ts: 12.0, label: 'balconies' }, { clip_ts: 13.5, label: 'boom' }] },
    { id: 'C', clip_id: 'c_0212', platform: 'x', url: '…', embed_url: '…', uploader: '…',
      posted_at: '2026-03-14T02:52:00+02:00', camera: cam(330, 690, 75, 80),
      boom_distance_m: 686, offset_s: -12.4, aligned: true, authenticity: 'real',
      graphic_level: 1, license: 'embed only', findings: [{ clip_ts: 12.4, label: 'flash' }, { clip_ts: 14.4, label: 'boom' }] },
    { id: 'D', clip_id: 'c_0230', platform: 'telegram', url: '…', embed_url: '…', uploader: '…',
      posted_at: '2026-03-14T03:05:00+02:00', camera: null,
      boom_distance_m: null, offset_s: 1075.0, aligned: false, authenticity: 'real',
      graphic_level: 2, license: 'embed only', findings: [{ clip_ts: 5.0, label: 'second impact' }] },
    { id: 'E', clip_id: 'c_0244', platform: 'telegram', url: '…', embed_url: '…', uploader: '…',
      posted_at: '2026-03-14T02:58:00+02:00', camera: cam(30, 890, 65, 350),
      boom_distance_m: null, offset_s: 38.0, aligned: true, authenticity: 'unsure',
      graphic_level: 1, license: 'embed only', findings: [{ clip_ts: 3.0, label: 'smoke already visible' }] },
  ],
  summary: `Strike on a ${levels}-floor apartment block… (Carbon)`,
  verification: { agree_place: true, agree_time: true, corroboration: 'high', n_sources: 5, n_rejected: 1 },
  answer_key: { source: 'Bellingcat', lat: r6(impact.lat + 0.00018), lon: r6(impact.lon - 0.00012), url: '…' },
  is_sample: true,
}
fs.writeFileSync(path.join(pub, 'sample_incident.json'), JSON.stringify(sample, null, 2) + '\n')

const sampleIndex = {
  incidents: [{
    id: sample.id, city: sample.city, title: sample.title,
    time: { impact_local: sample.time.impact_local },
    impact: { lat: sample.impact.lat, lon: sample.impact.lon, radius_m: sample.impact.radius_m },
    verification: sample.verification, is_sample: true,
  }],
  run: { n_clips: 6, n_rejected: 1 },
  is_sample: true,
}
fs.writeFileSync(path.join(pub, 'sample_index.json'), JSON.stringify(sampleIndex, null, 2) + '\n')
console.log('wrote public/sample_incident.json, public/sample_index.json')
