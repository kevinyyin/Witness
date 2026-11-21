// §9.3 endpoints (all under /api, proxied by Vite to 127.0.0.1:8000) + the recorded fixtures.
import { readStream, type StreamEvent } from './sse'

export type Health = { ok: boolean; youtube_url_input: boolean }
export type Truth = 'real_strike' | 'video_game' | 'movie' | 'fireworks_demolition' | 'other'
export type Scoreboard = { tries: number; right: number; history: { clip_id: string; verdict: string; label: string | null; truth: Truth; right: boolean }[] }

/** null = backend unreachable → fixture replay under SAMPLE DATA (§9.3). */
export async function health(): Promise<Health | null> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    return r.ok ? ((await r.json()) as Health) : null
  } catch { return null }
}

export type Input = { url: string; claimed_place: string | null } | { file: File; claimed_place: string | null }

export async function analyze(input: Input, onEvent: (e: StreamEvent) => void): Promise<void> {
  let init: RequestInit
  if ('file' in input) {
    const fd = new FormData()
    fd.append('file', input.file)
    if (input.claimed_place) fd.append('claimed_place', input.claimed_place)
    init = { method: 'POST', body: fd }
  } else {
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
  }
  const r = await fetch('/api/analyze', { ...init, signal: AbortSignal.timeout(120_000) }) // a hung model call must not leave the panel spinning
  if (!r.ok || !r.body) throw new Error(`analyze failed: HTTP ${r.status}`)
  await readStream(r.body, onEvent)
}

export async function scoreboard(): Promise<Scoreboard | null> {
  try { const r = await fetch('/api/judge'); return r.ok ? ((await r.json()) as Scoreboard) : null } catch { return null }
}

export async function judge(clip_id: string, truth: Truth): Promise<Scoreboard> {
  const r = await fetch('/api/judge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clip_id, truth }) })
  if (!r.ok) throw new Error(`judge failed: HTTP ${r.status}`)
  return (await r.json()) as Scoreboard
}

export type Fixture = 'analyze_fake' | 'analyze_real'

/** Replays a recorded /api/analyze body with a short pause per event so the stages visibly tick. */
export async function replayFixture(name: Fixture, onEvent: (e: StreamEvent) => void, pauseMs = 700): Promise<void> {
  const r = await fetch(`${import.meta.env.BASE_URL}fixtures/${name}.txt`, { cache: 'no-store' })
  const text = r.ok ? await r.text() : ''
  if (!text.includes('event:')) throw new Error(`fixtures/${name}.txt is not there yet (the pipeline commits it by 1:30)`)
  const events: StreamEvent[] = []
  await readStream(new Response(text).body!, (e) => events.push(e))
  for (const e of events) { onEvent(e); await new Promise((r) => setTimeout(r, pauseMs)) }
}
