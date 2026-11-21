// Builds web/public/sample_incident.json + sample_index.json from the spec Rev 2 §9.2 example (the contract fixture).
// Run: npm run make-sample   (reads $WITNESS_DATA/osm, default ../data/osm)
//
// §9.2 "Sample files": osm_file and target point at a real building file from data/osm/, and real clips replace "…".
// The example's coordinates are kilometres from every extract we have, so the whole geometry is shifted by one
// constant offset onto Kharkiv_buildings_2024-06-22.json: every distance, time and offset in the example still agrees.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, '..')
const dataDir = path.resolve(process.env.WITNESS_DATA ?? path.join(web, '..', 'data'))
const OSM = 'Kharkiv_buildings_2024-06-22.json'
fs.copyFileSync(path.join(dataDir, 'osm', OSM), path.join(web, 'public', 'osm', OSM)) // §4.3: the visualizer copies the sample's file
const osm = JSON.parse(fs.readFileSync(path.join(dataDir, 'osm', OSM), 'utf8'))

// ---- the §9.2 example, verbatim except is_sample ----
const ex = {
  id: '0412', city: 'Kharkiv', title: 'Strike on apartment block, Saltivskyi district',
  osm_file: 'osm/Kharkiv_buildings_2026-03-14.json',
  time: { impact_local: '2026-03-14T02:41:07+02:00', plus_minus_s: 360, basis: 'earliest post + aligned offsets' },
  impact: { lat: 49.9905, lon: 36.3305, radius_m: 40, method: 'evidence_rings', confidence: 0.78 },
  target: { osm_id: 'way/123', footprint: [[36.33, 49.99], [36.331, 49.99], [36.331, 49.991], [36.33, 49.991]],
    levels: 16, osm_tags: { building: 'apartments' }, visual_basis: ['B@0:12 balconies'] },
  weapon: { options: { shahed_drone: 0.71, cruise_missile: 0.14, ballistic_missile: 0.06, glide_bomb: 0.0,
    rocket_cluster: 0.0, tube_artillery: 0.0, fpv_drone: 0.0, unknown: 0.09 },
    evidence: ['A@0:06 engine buzz', 'C@0:02 engine buzz'] },
  flags: [
    { type: 'residential', label: 'Residential building · 16 floors', status: 'raised', confidence: 0.94,
      t: 0.0, t_end: null, anchor: { kind: 'building', ref: 'way/123' }, source: 'B', clip_ts: 12.0, basis: ['osm:building=apartments', 'B@0:12 balconies'] },
    { type: 'night_strike', label: 'Night strike (02:41 local)', status: 'raised', confidence: 0.99,
      t: 0.0, t_end: null, anchor: { kind: 'clock' }, source: null, clip_ts: null, basis: ['time.impact_local'] },
    { type: 'dense_population', label: 'Densely populated · 212 buildings within 300 m', status: 'raised', confidence: 0.85,
      t: 0.0, t_end: null, anchor: { kind: 'impact' }, source: null, clip_ts: null, basis: ['osm: 212 buildings within 300 m'] },
    { type: 'protected_site', label: 'Hospital / school / worship / shelter nearby', status: 'checked_none', confidence: null,
      t: null, t_end: null, anchor: null, source: null, clip_ts: null, basis: [] },
    { type: 'indiscriminate_weapon', label: 'Indiscriminate-weapon indicator', status: 'checked_none', confidence: null,
      t: null, t_end: null, anchor: null, source: null, clip_ts: null, basis: [] },
    { type: 'second_strike', label: 'Second strike on responders', status: 'checked_none', confidence: null,
      t: null, t_end: null, anchor: null, source: null, clip_ts: null, basis: [] },
    { type: 'uxo', label: 'Unexploded ordnance visible', status: 'checked_none', confidence: null,
      t: null, t_end: null, anchor: null, source: null, clip_ts: null, basis: [] },
    { type: 'military_object', label: 'Military object visible', status: 'checked_none', confidence: null,
      t: null, t_end: null, anchor: null, source: null, clip_ts: null, basis: [] },
  ],
  review_notes: [
    { type: 'time_conflict', label: 'Clips C and E disagree on time by 40 s', confidence: 0.8,
      t: 41.0, t_end: 45.0, anchor: { kind: 'cameras', ref: ['C', 'E'] }, source: 'E', clip_ts: 3.0, basis: ['C@0:12 impact', 'E@0:03 smoke already visible'] },
    { type: 'weak_camera', label: 'Camera D position is weak (±350 m)', confidence: 0.9,
      t: 1020.0, t_end: null, anchor: { kind: 'camera', ref: 'D' }, source: 'D', clip_ts: 0.0, basis: ['camera.radius_m=350'] },
  ],
  timeline: [
    { t: -14.0, type: 'siren', source: 'A', clip_ts: 2.2, confidence: 0.9 },
    { t: -10.4, type: 'engine_buzz', source: 'C', clip_ts: 2.0, confidence: 0.8 },
    { t: -9.6, type: 'engine_buzz', source: 'A', clip_ts: 6.6, confidence: 0.8 },
    { t: 0.0, type: 'impact', source: 'C', clip_ts: 12.4, confidence: 0.95 },
    { t: 0.9, type: 'boom_heard', source: 'C', clip_ts: 13.3, confidence: 0.9 },
    { t: 1.9, type: 'boom_heard', source: 'B', clip_ts: 9.9, confidence: 0.9 },
    { t: 3.1, type: 'boom_heard', source: 'A', clip_ts: 19.3, confidence: 0.9 },
    { t: 6.0, type: 'fire', source: 'B', clip_ts: 14.0, confidence: 0.85 },
    { t: 41.0, type: 'fire', source: 'E', clip_ts: 3.0, confidence: 0.7 },
    { t: 1075.0, type: 'rescue', source: 'D', clip_ts: 55.0, confidence: 0.9 },
  ],
  sources: [
    { id: 'A', clip_id: 'c_0187', platform: 'telegram', url: '…', embed_url: '…', player: 'embed', media_url: null, uploader: '…',
      posted_at: '2026-03-14T02:44:00+02:00', duration_s: 31.0,
      camera: { lat: 49.98502, lon: 36.31833, heading_deg: 55, fov_deg: 70, radius_m: 60, confidence: 0.8 },
      boom_distance_m: 1063, offset_s: -16.2, aligned: true, authenticity: 'real', reject_reason: null, graphic_level: 1, license: 'embed only',
      findings: [{ clip_ts: 2.2, label: 'siren', confidence: 0.9 }, { clip_ts: 6.6, label: 'engine buzz', confidence: 0.8 }, { clip_ts: 19.3, label: 'boom', confidence: 0.9 }] },
    { id: 'B', clip_id: 'c_0188', platform: 'youtube', url: '…', embed_url: '…', player: 'youtube', media_url: null, uploader: '…',
      posted_at: '2026-03-14T03:10:00+02:00', duration_s: 40.0,
      camera: { lat: 49.98757, lon: 36.33839, heading_deg: 300, fov_deg: 60, radius_m: 80, confidence: 0.7 },
      boom_distance_m: 652, offset_s: -8.0, aligned: true, authenticity: 'real', reject_reason: null, graphic_level: 1, license: 'embed only',
      findings: [{ clip_ts: 9.9, label: 'boom', confidence: 0.9 }, { clip_ts: 12.0, label: 'balconies', confidence: 0.9 }] },
    { id: 'C', clip_id: 'c_0189', platform: 'youtube', url: '…', embed_url: '…', player: 'youtube', media_url: null, uploader: '…',
      posted_at: '2026-03-14T02:58:00+02:00', duration_s: 22.0,
      camera: { lat: 49.99311, lon: 36.33198, heading_deg: 200, fov_deg: 70, radius_m: 40, confidence: 0.9 },
      boom_distance_m: 309, offset_s: -12.4, aligned: true, authenticity: 'real', reject_reason: null, graphic_level: 1, license: 'embed only',
      findings: [{ clip_ts: 12.4, label: 'flash', confidence: 0.95 }, { clip_ts: 13.3, label: 'boom', confidence: 0.9 }] },
    { id: 'D', clip_id: 'c_0190', platform: 'commons', url: '…', embed_url: null, player: 'file', media_url: '…', uploader: 'dsns.gov.ua',
      posted_at: '2026-03-14T04:30:00+02:00', duration_s: 95.0,
      camera: { lat: 49.99266, lon: 36.32469, heading_deg: 120, fov_deg: 60, radius_m: 350, confidence: 0.3 },
      boom_distance_m: null, offset_s: 1020.0, aligned: false, authenticity: 'real', reject_reason: null, graphic_level: 1, license: 'CC BY 4.0 · dsns.gov.ua',
      findings: [{ clip_ts: 55.0, label: 'rescue crews', confidence: 0.9 }] },
    { id: 'E', clip_id: 'c_0191', platform: 'x', url: '…', embed_url: '…', player: 'embed', media_url: null, uploader: '…',
      posted_at: '2026-03-14T02:50:00+02:00', duration_s: 48.0,
      camera: { lat: 49.98254, lon: 36.33268, heading_deg: 350, fov_deg: 50, radius_m: 150, confidence: 0.5 },
      boom_distance_m: null, offset_s: 38.0, aligned: true, authenticity: 'unsure', reject_reason: null, graphic_level: 1, license: 'embed only',
      findings: [{ clip_ts: 3.0, label: 'smoke already visible', confidence: 0.7 }] },
    { id: 'F', clip_id: 'c_0192', platform: 'telegram', url: '…', embed_url: '…', player: 'embed', media_url: null, uploader: '…',
      posted_at: '2026-03-14T05:00:00+02:00', duration_s: 60.0, camera: null,
      boom_distance_m: null, offset_s: null, aligned: false, authenticity: 'fake', reject_reason: 'recycled: pHash match to an older upload',
      graphic_level: 0, license: 'embed only', findings: [] },
  ],
  summary: 'Probably a strike on a 16-floor apartment block… (Carbon)',
  verification: { agree_place: true, agree_time: false, corroboration: 'high', n_sources: 5, n_rejected: 1 },
  answer_key: { source: 'Bellingcat', lat: 49.9903, lon: 36.3303, url: '…' },
  is_sample: false,
}

// ---- pick a real target and shift the geometry onto it ----
const k = Math.PI / 180
const centre = { lat: osm.center[0], lon: osm.center[1] } // extracts store [lat, lon]
const dist = (a, b) => Math.hypot((b.lon - a.lon) * k * Math.cos(a.lat * k), (b.lat - a.lat) * k) * 6371000
const centroid = (g) => {
  const p = g.length > 1 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon ? g.slice(0, -1) : g
  return { lat: p.reduce((s, q) => s + q.lat, 0) / p.length, lon: p.reduce((s, q) => s + q.lon, 0) / p.length }
}
const ways = osm.elements.filter((e) => e.geometry).map((e) => ({ e, c: centroid(e.geometry) }))
const pick = ways
  .filter(({ e }) => ['apartments', 'residential'].includes(e.tags?.building) && Number(e.tags?.['building:levels']) >= 9)
  .sort((a, b) => dist(centre, a.c) - dist(centre, b.c))[0]
if (!pick) throw new Error(`no apartments way with >= 9 levels in ${OSM}`)
const r6 = (x) => Math.round(x * 1e6) / 1e6
const dLat = pick.c.lat - ex.impact.lat, dLon = pick.c.lon - ex.impact.lon
const shift = (o) => { o.lat = r6(o.lat + dLat); o.lon = r6(o.lon + dLon) }
const s = structuredClone(ex)
shift(s.impact); shift(s.answer_key)
for (const src of s.sources) if (src.camera) shift(src.camera)

const levels = Number(pick.e.tags['building:levels'])
const tag = pick.e.tags.building
const wayId = `way/${pick.e.id}`
const within300 = ways.filter(({ c }) => dist(s.impact, c) <= 300).length
Object.assign(s, { id: 'sample', osm_file: `osm/${OSM}`, is_sample: true })
s.target = { osm_id: wayId, footprint: pick.e.geometry.map((p) => [p.lon, p.lat]), levels, osm_tags: { building: tag }, visual_basis: ['B@0:12 balconies'] }
const [res, , dense] = s.flags
Object.assign(res, { label: `Residential building · ${levels} floors`, anchor: { kind: 'building', ref: wayId }, basis: [`osm:building=${tag}`, 'B@0:12 balconies'] })
Object.assign(dense, { label: `Densely populated · ${within300} buildings within 300 m`, basis: [`osm: ${within300} buildings within 300 m`] })
s.summary = `Probably a strike on a ${levels}-floor apartment block… (Carbon)`

// Clip D (`player: "file"`): a real Commons clip by its own https address (§9.2). CC BY 4.0. Not yet screened by eye.
Object.assign(s.sources.find((x) => x.id === 'D'), {
  url: 'https://commons.wikimedia.org/wiki/File:Kharkiv_Art_Museum_after_Russian_attack,_2026-06-14_(001).webm',
  media_url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/9/99/Kharkiv_Art_Museum_after_Russian_attack%2C_2026-06-14_%28001%29.webm/Kharkiv_Art_Museum_after_Russian_attack%2C_2026-06-14_%28001%29.webm.480p.vp9.webm',
  uploader: 'State Emergency Service of Ukraine', license: 'CC BY 4.0 · State Emergency Service of Ukraine (dsns.gov.ua)', duration_s: 98.6,
})
// Clips B and C (`player: "youtube"`) keep "…" until a real, screened YouTube link is chosen.

const out = path.join(web, 'public')
fs.writeFileSync(path.join(out, 'sample_incident.json'), JSON.stringify(s, null, 2) + '\n')
fs.writeFileSync(path.join(out, 'sample_index.json'), JSON.stringify({
  is_sample: true, city: s.city, n_clips: s.sources.length, n_rejected: s.verification.n_rejected,
  incidents: [{ id: s.id, title: s.title, lat: s.impact.lat, lon: s.impact.lon, radius_m: s.impact.radius_m,
    n_sources: s.verification.n_sources, corroboration: s.verification.corroboration, impact_local: s.time.impact_local }],
}, null, 2) + '\n')
console.log(`target ${wayId} (${tag}, ${levels} floors) at ${s.impact.lat},${s.impact.lon}; ${within300} buildings within 300 m`)

// Contract check (§9.2: same keys at every level as the example)
const keys = (o, p = '') => (o && typeof o === 'object' && !Array.isArray(o)) ? Object.keys(o).flatMap((k2) => [p + k2, ...keys(o[k2], p + k2 + '.')]) : []
const a = new Set(keys(ex)), b = new Set(keys(s))
const diff = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)))
if (diff.length) throw new Error('sample keys differ from the §9.2 example: ' + diff.join(', '))
console.log('keys match the §9.2 example')
