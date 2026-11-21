// Time-anchored callouts (§7.1.5): pure functions of t, positioned every frame by projecting their anchor.
// Text comes only from JSON fields (label, basis, confidence, measured values). No hand-written labels.
import { useEffect, useMemo, useRef } from 'react'
import type { Incident, OsmFile } from '../types'
import type { WitnessScene } from '../scene/Scene'
import { resolveAnchor, type Resolved } from '../scene/anchors'
import { calloutState, fmtT, mmss } from '../time/derive'
import { overlays } from '../time/loop'

type Item = { kind: 'flag' | 'note' | 'boom'; label: string; sub: string; t: number; t_end: number | null; anchor: Resolved }

const conf = (c: number | null | undefined) => `conf ${c == null ? '—' : c.toFixed(2)}`
const sym = { flag: '▲', note: '●', boom: '◎' }

export function buildItems(inc: Incident, osm: OsmFile | null): Item[] {
  const items: Item[] = []
  for (const [list, kind] of [[inc.flags, 'flag'], [inc.review_notes, 'note']] as const)
    for (const f of list)
      if (f.t != null)
        items.push({ kind, label: f.label, sub: [...f.basis, conf(f.confidence)].join(' · '), t: f.t, t_end: f.t_end, anchor: resolveAnchor(inc, osm, f.anchor) })
  // "boom heard +3.1 s → 1.06 km" at the camera that heard it (§7.1.4), from the measured event + boom_distance_m
  for (const e of inc.timeline) {
    if (e.type !== 'boom_heard' || !e.source) continue
    const d = inc.sources.find((s) => s.id === e.source)?.boom_distance_m
    items.push({
      kind: 'boom', label: `boom heard ${fmtT(e.t)}${d ? ` → ${(d / 1000).toFixed(2)} km` : ''}`,
      sub: [`${e.source}@${mmss(e.clip_ts ?? 0)}`, conf(e.confidence)].join(' · '),
      t: e.t, t_end: e.t + 3, anchor: resolveAnchor(inc, osm, { kind: 'camera', ref: e.source }),
    })
  }
  return items
}

export function Callouts({ inc, osm, getScene }: { inc: Incident; osm: OsmFile | null; getScene: () => WitnessScene | null }) {
  const items = useMemo(() => buildItems(inc, osm), [inc, osm])
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const pins = useRef<(HTMLDivElement | null)[]>([])
  const leaders = useRef<(SVGPathElement | null)[]>([])

  useEffect(() => {
    const draw = (t: number) => {
      const s = getScene()
      items.forEach((it, i) => {
        const card = cards.current[i], pin = pins.current[i], path = leaders.current[i]
        if (!card || !pin || !path) return
        const st = calloutState(it, t)
        const hide = () => { card.style.display = 'none'; pin.style.display = 'none'; path.setAttribute('d', '') }
        if (it.anchor === 'clock') { // screen-level: stacked under the clock
          card.style.display = st.state === 'full' ? '' : 'none'
          card.style.opacity = String(st.opacity)
          return
        }
        const pts = s && it.anchor ? it.anchor.map((v) => s.project(v)).filter((p) => p.visible) : []
        if (st.state === 'hidden' || !pts.length) return hide()
        const W = s?.renderer.domElement.clientWidth ?? 800, H = s?.renderer.domElement.clientHeight ?? 600
        const p = pts.find((q) => q.x >= 0 && q.x <= W && q.y >= 0 && q.y <= H) ?? pts[0] // card follows an on-screen anchor
        if (st.state === 'pin') {
          hide()
          pin.style.display = ''
          pin.style.transform = `translate(${p.x - 6}px, ${p.y - 8}px)`
          return
        }
        const x = Math.max(8, Math.min(p.x + 50, W - 300)), y = Math.max(40, Math.min(p.y - 110, H - 140))
        card.style.display = ''
        card.style.opacity = String(st.opacity)
        card.style.transform = `translate(${x}px, ${y}px)`
        pin.style.display = 'none'
        path.setAttribute('d', pts.map((q) => `M${x} ${y + 14} L${q.x} ${q.y}`).join(' '))
        path.style.opacity = String(st.opacity)
      })
    }
    overlays.add(draw)
    return () => { overlays.delete(draw) }
  }, [items, getScene])

  const card = (it: Item, i: number) => (
    <div key={i} ref={(el) => { cards.current[i] = el }} className={`callout ${it.kind}`} style={{ display: 'none' }}>
      <b>{sym[it.kind]} {it.label}</b>
      <div className="basis">{it.sub}</div>
    </div>
  )
  return (
    <>
      <svg className="leaders">
        {items.map((it, i) => <path key={i} ref={(el) => { leaders.current[i] = el }} className={it.kind} />)}
      </svg>
      {items.map((it, i) => (it.anchor === 'clock' ? null : card(it, i)))}
      {items.map((it, i) => (
        <div key={i} ref={(el) => { pins.current[i] = el }} className={`pin ${it.kind}`} style={{ display: 'none' }}
          title={`${it.label}\n${it.sub}`}>{sym[it.kind]}</div>
      ))}
      <div className="clock-stack">{items.map((it, i) => (it.anchor === 'clock' ? card(it, i) : null))}</div>
    </>
  )
}
