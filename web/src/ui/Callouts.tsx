// Time-anchored callouts (§7.1.5): pure functions of t, positioned every frame by projecting their anchor.
// Text comes only from JSON fields (label, basis, confidence, measured values). No hand-written labels.
import { useEffect, useMemo, useRef } from 'react'
import type { Incident, OsmFile } from '../types'
import type { WitnessScene } from '../scene/Scene'
import { resolveAnchor, type Resolved } from '../scene/anchors'
import { calloutState, fmtT, mmss } from '../time/derive'
import { overlays } from '../time/loop'
import { witnesses } from '../scene/walkthrough'
import { distanceM } from '../data/load'

type Item = { kind: 'flag' | 'note' | 'boom' | 'witness'; label: string; sub: string; t: number; t_end: number | null; anchor: Resolved }

const conf = (c: number | null | undefined) => `conf ${c == null ? '—' : c.toFixed(2)}`
const sym = { flag: '▲', note: '●', boom: '◎', witness: '◉' }

export function buildItems(inc: Incident, osm: OsmFile | null): Item[] {
  const items: Item[] = []
  for (const [list, kind] of [[inc.flags, 'flag'], [inc.review_notes, 'note']] as const)
    for (const f of list)
      if (f.t != null)
        // §9.2: an anchor at a null camera or a building not in osm_file is pinned screen-level, like the clock.
        items.push({ kind, label: f.label, sub: [...f.basis, conf(f.confidence)].join(' · '), t: f.t, t_end: f.t_end, anchor: resolveAnchor(inc, osm, f.anchor) ?? 'clock' })
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
  // Walkthrough sweep (−10 → −2 s): "A · telegram · 1.06 km away" at each witness in turn (§7.1.4).
  const ws = witnesses(inc), slot = 8 / Math.max(1, ws.length)
  ws.forEach((w, i) => {
    const s = inc.sources.find((x) => x.id === w.id)!, cam = s.camera!
    const km = ((s.boom_distance_m ?? distanceM(inc.impact, cam)) / 1000).toFixed(2)
    items.push({
      kind: 'witness', label: `${s.id} · ${s.platform} · ${km} km away`,
      sub: [s.boom_distance_m != null ? 'flash→boom distance' : 'from camera position', `camera ±${cam.radius_m} m`, `location conf ${cam.confidence.toFixed(2)}`].join(' · '),
      t: -10 + i * slot, t_end: -10 + (i + 1) * slot, anchor: resolveAnchor(inc, osm, { kind: 'camera', ref: s.id }),
    })
  })
  return items
}

export function Callouts({ inc, osm, getScene }: { inc: Incident; osm: OsmFile | null; getScene: () => WitnessScene | null }) {
  const items = useMemo(() => buildItems(inc, osm), [inc, osm])
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const pins = useRef<(HTMLDivElement | null)[]>([])
  const leaders = useRef<(SVGPathElement | null)[]>([])
  const hover = useRef<number | null>(null)

  useEffect(() => {
    const draw = (t: number) => {
      const s = getScene()
      // cards already laid out this frame (x, y, w, h); the clock + its screen-level stack (top right) is reserved
      const cw = s?.renderer.domElement.clientWidth ?? 800, stack = document.querySelector<HTMLElement>('.clock-stack')
      const placed: [number, number, number, number][] = [[cw - 310, 0, 310, 100 + (stack?.offsetHeight ?? 0)], [0, 0, 480, 64]] // + the title, top left
      // the picture-in-picture video (bottom right) is reserved too
      const pip = document.querySelector<HTMLElement>('.pip'), cv = s?.renderer.domElement
      if (pip && cv) { const a = cv.getBoundingClientRect(), b = pip.getBoundingClientRect(); placed.push([b.left - a.left, b.top - a.top - 30, b.width, b.height + 30]) }
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
          if (hover.current !== i) return // hovering a pin re-opens its callout (§7.1.5)
        }
        const op = st.state === 'pin' ? 1 : st.opacity
        card.style.display = ''
        const w = card.offsetWidth || 280, h = card.offsetHeight || 40
        // cards live at the left/right edge (the side their anchor is on) so the area of interest stays clear
        // several callouts at once (e.g. every impact flag at t = 0): push down until it overlaps no earlier card
        const place = (lft: boolean): [number, number] => {
          const cx = lft ? 16 : W - 16 - w
          let cy = Math.max(70, Math.min(p.y - h / 2, H - h - 16))
          for (let k = 0; k < placed.length; k++) {
            const [px, py, pw, ph] = placed[k]
            if (cx < px + pw && cx + w > px && cy < py + ph + 6 && cy + h + 6 > py) { cy = py + ph + 6; k = -1 }
          }
          return [cx, cy]
        }
        let left = p.x < W / 2
        let [x, y] = place(left)
        if (y + h > H - 8) { left = !left; [x, y] = place(left) } // no room on its side (e.g. under the video): use the other side
        placed.push([x, y, w, h])
        card.style.opacity = String(op)
        card.style.transform = `translate(${x}px, ${y}px)`
        if (st.state !== 'pin') pin.style.display = 'none'
        const sx = left ? x + w : x // leader leaves from the card's inner edge
        path.setAttribute('d', pts.map((q) => `M${sx} ${y + 14} L${q.x} ${q.y}`).join(' '))
        path.style.opacity = String(op)
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
          onMouseEnter={() => { hover.current = i }} onMouseLeave={() => { hover.current = null }}>{sym[it.kind]}</div>
      ))}
      <div className="clock-stack">{items.map((it, i) => (it.anchor === 'clock' ? card(it, i) : null))}</div>
    </>
  )
}
