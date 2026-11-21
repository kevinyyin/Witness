// Data contracts from WITNESS_SPEC.md Revision 2 §9. Field names are exact; do not rename.
// §9.0: every key is always present; null only where §9 says so.

export type Verdict = 'real' | 'fake' | 'unsure'

// ---- §9.1 Clip record (/api/analyze result) ----
export type FakeCheck = { name: 'flash_to_boom' | 'repeated_sample' | 'render_hud' | 'seen_before'; result: 'pass' | 'fail' | 'n/a'; detail: string; clip_ts: number | null }
export type Weapon = { options: Record<string, number>; evidence: string[] } // same shape in §9.1 and §9.2

export type ClipRecord = {
  clip_id: string
  source_url: string | null
  platform: 'youtube' | 'telegram' | 'x' | 'commons' | 'upload'
  embed_url: string | null
  sha256: string | null
  duration_s: number
  posted_at: string | null
  claimed_place: string | null
  timeline: { clip_ts: number; type: string; label: string; confidence: number }[]
  triage: { war_related: number; event_type: Record<string, number>; graphic_level: number; civilian_objects: number; uxo: number; military_object: number }
  fake: { verdict: Verdict; label: string | null; confidence: number; checks: FakeCheck[] }
  location: { lat: number; lon: number; radius_m: number; level: 'point' | 'district' | 'city' | 'unknown'; method: string; evidence: string[]; candidates: number } | null
  weapon: Weapon | null
  incident_id: string | null
  stages_ms: Record<string, number | null>
}

// ---- §9.2 Incident ----
export type Anchor =
  | { kind: 'point'; lat: number; lon: number; alt_m: number }
  | { kind: 'building'; ref: string }
  | { kind: 'impact' }
  | { kind: 'camera'; ref: string }
  | { kind: 'cameras'; ref: string[] }
  | { kind: 'clock' }

export type Flag = {
  type: string
  label: string
  status?: 'raised' | 'checked_none' // flags only
  confidence: number | null
  t: number | null
  t_end: number | null
  anchor: Anchor | null
  source: string | null // the clip moment this is based on (click seeks there)
  clip_ts: number | null
  basis: string[] // display text only, never parsed
}
export type ReviewNote = Flag

export type TimelineEvent = { t: number; type: string; source: string; clip_ts: number; confidence: number; anchor?: Anchor }

export type Camera = { lat: number; lon: number; heading_deg: number; fov_deg: number; radius_m: number; confidence: number }

export type Source = {
  id: string
  clip_id: string
  platform: string
  url: string | null
  embed_url: string | null
  player: 'youtube' | 'file' | 'embed'
  media_url: string | null
  uploader: string
  posted_at: string | null
  duration_s: number
  camera: Camera | null
  boom_distance_m: number | null
  offset_s: number | null
  aligned: boolean
  authenticity: Verdict
  reject_reason: string | null
  graphic_level: number
  license: string
  findings: { clip_ts: number; label: string; confidence: number }[]
}

export type Incident = {
  id: string
  city: string
  title: string
  osm_file: string // path under web/public/
  time: { impact_local: string; plus_minus_s: number; basis: string }
  impact: { lat: number; lon: number; radius_m: number; method: string; confidence: number }
  target: { osm_id: string; footprint: [number, number][]; levels: number; osm_tags: Record<string, string>; visual_basis: string[] } | null
  weapon: Weapon | null
  flags: Flag[]
  review_notes: ReviewNote[]
  timeline: TimelineEvent[]
  sources: Source[]
  summary: string | null
  verification: { agree_place: boolean; agree_time: boolean; corroboration: string; n_sources: number; n_rejected: number }
  answer_key: { source: string; lat: number; lon: number; url: string } | null
  is_sample: boolean
}

// ---- §9.3 web/public/incidents/index.json (and sample_index.json) ----
export type IndexEntry = { id: string; title: string; lat: number; lon: number; radius_m: number; n_sources: number; corroboration: string; impact_local: string }
export type IncidentIndex = { is_sample: boolean; city: string; n_clips: number; n_rejected: number; incidents: IndexEntry[] }

// ---- OSM (Overpass `out geom` shape; the extracts store center as [lat, lon]) ----
export type OsmWay = { type: 'way'; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }
export type OsmFile = { center?: [number, number]; radius_m?: number; elements: OsmWay[] }
