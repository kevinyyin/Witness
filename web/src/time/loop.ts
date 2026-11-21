import { useTime } from './store'
import { slowmo } from './derive'
import type { Ruler } from './ruler'

/** Per-frame DOM updaters (callout positions etc.); called after the scene renders. */
export const overlays = new Set<(t: number) => void>()

/** The one animation loop: advances t while playing, then draws everything from t. */
export function startLoop(ruler: Ruler, draw: (t: number) => void): () => void {
  let raf = 0, last = performance.now()
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    const s = useTime.getState()
    if (s.playing) {
      let t = s.t + dt * s.speed * (s.mode === 'walk' ? slowmo(s.t) : 1)
      const gap = ruler.gaps.find((g) => t > g.t0 && t < g.t1)
      if (gap) t = gap.t1 // hard cut over a compressed gap (§7.1.4)
      if (t >= ruler.end) { t = ruler.end; useTime.setState({ playing: false }) }
      useTime.setState({ t })
    }
    const t = useTime.getState().t
    draw(t)
    for (const f of overlays) f(t)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
