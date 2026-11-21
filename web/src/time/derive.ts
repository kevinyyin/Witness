// Pure functions of scene time t (s, 0 = impact). Scrubbing backward just re-evaluates them (§7.1.5).
import type { Incident, Source } from '../types'

/** A clip's span on the scene clock (§7.1.6): offset_s → offset_s + duration_s; offset_s null = no lane. */
export const laneOf = (s: Source) => (s.offset_s == null ? null : { t0: s.offset_s, t1: s.offset_s + s.duration_s })

/** Sidebar clip for the playhead (§7.1.7): the pinned one, else the clip that saw the impact if it covers t,
 *  else the aligned clip covering t with the earliest offset, else an unaligned one. */
export function pickClip(inc: Incident, t: number, pinned: string | null): Source | null {
  if (pinned) return inc.sources.find((s) => s.id === pinned) ?? null
  const covers = (s: Source) => { const l = laneOf(s); return !!l && s.authenticity !== 'fake' && t >= l.t0 && t <= l.t1 }
  const impact = inc.timeline.filter((e) => e.type === 'impact').sort((a, b) => Math.abs(a.t) - Math.abs(b.t))[0]?.source
  const c = inc.sources.filter(covers).sort((a, b) => Number(b.aligned !== false) - Number(a.aligned !== false) || (a.offset_s ?? 0) - (b.offset_s ?? 0))
  return c.find((s) => s.id === impact) ?? c[0] ?? null
}

/** Target heat 0..1: calm before impact, white → amber → red over 1.5 s, then stays red (§7.1.2). */
export const heatAt = (t: number) => (t <= 0 ? 0 : Math.min(1, t / 1.5))

/** Impact flash intensity: 1 at t = 0, gone by +0.6 s. */
export const flashAt = (t: number) => (t < 0 || t > 0.6 ? 0 : 1 - t / 0.6)

/** Sound wave radius at 343 m/s of scene time (§7.1.3). */
export const waveRadiusM = (t: number) => (t > 0 ? 343 * t : 0)

/** Walkthrough slow motion: 0.25x within 1.5 s of impact, easing back to 1x by 3 s (§7.1.4). */
export const slowmo = (t: number) => {
  const a = Math.abs(t)
  return a < 1.5 ? 0.25 : a < 3 ? 0.25 + ((a - 1.5) / 1.5) * 0.75 : 1
}

/** Every time-specific item: timeline events, flags and review notes with non-null t. */
export function markTimes(inc: Incident): number[] {
  return [
    ...inc.timeline.map((e) => e.t),
    ...[...inc.flags, ...inc.review_notes].flatMap((f) => (f.t == null ? [] : [f.t])),
  ]
}

export type CalloutState = { state: 'hidden' | 'full' | 'pin'; opacity: number }

const FADE = 0.3 // §7.1.2

/** Full callout from t to t_end (default t + 4 s), then a pin; t: null never shows in the scene (§7.1.5).
 *  Fades in over the 0.3 s *before* t so it is fully visible when you land exactly on t (← → keys, marker clicks). */
export function calloutState(item: { t: number | null; t_end: number | null }, t: number): CalloutState {
  if (item.t == null || t < item.t - FADE) return { state: 'hidden', opacity: 0 }
  const end = item.t_end ?? item.t + 4
  if (t >= end) return { state: 'pin', opacity: 1 }
  return { state: 'full', opacity: Math.min(1, (t - item.t + FADE) / FADE, (end - t) / FADE) }
}

/** True for 0.6 s after this source's measured boom_heard event (the camera blinks, §7.1.5). */
export function blinkAt(inc: Incident, sourceId: string, t: number): boolean {
  const e = inc.timeline.find((x) => x.type === 'boom_heard' && x.source === sourceId)
  return !!e && t >= e.t && t < e.t + 0.6
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Absolute local time at the playhead with its ± (§7.1.2), in the offset written in time.impact_local. */
export function clockAt(inc: Incident, t: number): string {
  const m = /([+-])(\d\d):?(\d\d)$/.exec(inc.time.impact_local)
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
  const d = new Date(Date.parse(inc.time.impact_local) + t * 1000 + offMin * 60000)
  const pm = inc.time.plus_minus_s
  const pmText = pm >= 60 ? `±${Math.round(pm / 60)} min` : `±${Math.round(pm)} s`
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (${pmText})`
}

/** Clip timestamp as m:ss. */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`

/** Scene time as "+3.1 s" / "−14.0 s". */
export const fmtT = (t: number) => `${t >= 0 ? '+' : '−'}${Math.abs(t).toFixed(1)} s`
