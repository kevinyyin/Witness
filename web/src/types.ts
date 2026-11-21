// Data contracts from WITNESS_SPEC.md §9. Field names are exact; do not rename.

// ---- §9.1 Clip record (/analyze response) ----
export type FakeCheck = { name: string; result: 'pass' | 'fail' | 'n/a' | string; detail?: string; clip_ts?: number }
export type WeaponOptions = Record<string, number> // shahed_drone, cruise_missile, ballistic_missile, glide_bomb, rocket_cluster, tube_artillery, fpv_drone, unknown

export type ClipRecord = {
  clip_id: string
  source_url?: string
  platform?: string
  embed_url?: string
  sha256?: string
  duration_s?: number
  posted_at?: string | null
  claimed_place?: string | null
  timeline?: { clip_ts: number; type: string; label?: string; conf?: number }[]
  triage?: {
    war_related?: number
    event_type?: Record<string, number>
    graphic_level?: number
    civilian_objects?: number
    uxo?: number
    military_object?: number
  }
  fake?: { verdict: 'real' | 'fake' | 'unsure' | string; label?: string; confidence?: number; checks?: FakeCheck[] }
  location?: {
    lat?: number | null; lon?: number | null; radius_m?: number | null
    level?: 'point' | 'district' | 'city' | 'unknown' | string
    method?: string; evidence?: string[]; candidates?: number
  }
  weapon?: WeaponOptions
  incident_id?: string | null
  stages_ms?: Record<string, number>
}

// ---- §9.2 Incident ----
export type Anchor =
  | { kind: 'point'; lat: number; lon: number; alt_m?: number }
  | { kind: 'building'; ref: string }
  | { kind: 'impact' }
  | { kind: 'camera'; ref: string }
  | { kind: 'cameras'; ref: string[] }
  | { kind: 'clock' }

export type Flag = {
  type: string
  label: string
  status?: 'raised' | 'checked_none' | string
  confidence: number | null
  t: number | null
  t_end: number | null
  anchor: Anchor | null
  basis: string[]
}
export type ReviewNote = Flag

export type TimelineEvent = {
  t: number
  type: string
  source?: string
  clip_ts?: number
  confidence?: number
  anchor?: Anchor
}

export type Camera = { lat: number; lon: number; heading_deg?: number; fov_deg?: number; radius_m?: number }

export type Source = {
  id: string
  clip_id?: string
  platform?: string
  url?: string
  embed_url?: string
  player?: 'youtube' | 'file' | 'embed' // not in this spec revision; honored if present
  uploader?: string
  posted_at?: string | null
  camera: Camera | null
  boom_distance_m?: number | null
  offset_s?: number | null
  aligned?: boolean
  authenticity?: string
  graphic_level?: number
  license?: string
  findings?: { clip_ts: number; label: string }[]
  duration_s?: number // proposed, not yet in §9.2
}

export type Incident = {
  id: string
  city: string
  title: string
  time: { impact_local: string; plus_minus_s: number; basis?: string }
  impact: { lat: number; lon: number; radius_m: number; method?: string; confidence?: number }
  target?: {
    osm_id: string
    footprint: [number, number][] // [lon, lat]
    levels?: number
    osm_tags?: Record<string, string>
    visual_basis?: string[]
  } | null
  weapon?: { options: WeaponOptions; evidence?: string[] }
  flags: Flag[]
  review_notes: ReviewNote[]
  timeline: TimelineEvent[]
  sources: Source[]
  summary?: string
  verification?: { agree_place?: boolean; agree_time?: boolean; corroboration?: string; n_sources?: number; n_rejected?: number }
  answer_key?: { source?: string; lat: number; lon: number; url?: string } | null
  is_sample: boolean
}

// ---- incidents/index.json (shape proposed in PLAN_VISUALIZER.md gap 9; §9.2 names only) ----
export type IndexEntry = Pick<Incident, 'id' | 'city' | 'title'> & {
  time?: Pick<Incident['time'], 'impact_local'>
  impact?: Pick<Incident['impact'], 'lat' | 'lon' | 'radius_m'>
  verification?: Incident['verification']
  is_sample?: boolean
}
export type IncidentIndex = {
  incidents: IndexEntry[]
  run?: { n_clips?: number; n_rejected?: number }
  is_sample: boolean
}

// ---- OSM (Overpass `out geom` shape) ----
export type OsmWay = { type: 'way'; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }
export type OsmFile = { center?: { lat: number; lon: number }; radius_m?: number; elements: OsmWay[] }
export type OsmIndexEntry = { file: string; city: string; center: { lat: number; lon: number }; radius_m: number }
