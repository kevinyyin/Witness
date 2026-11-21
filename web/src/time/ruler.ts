// §7.1.6 ruler: stretches > 60 s with no marks collapse into a fixed-width "⋯ N min ⋯" segment.
export type Gap = { t0: number; t1: number }
export type Ruler = { start: number; end: number; gaps: Gap[]; tToX: (t: number) => number; xToT: (x: number) => number }

const GAP_S = 60 // §7.1.6
const GAP_W = 0.06 // share of the width each gap takes
const PAD = 5 // keep 5 s of context on both sides of a gap (the hard cut lands 5 s before the next mark)

export function buildRuler(times: number[]): Ruler {
  const ts = [...new Set(times)].sort((a, b) => a - b)
  const start = Math.min(-20, (ts[0] ?? 0) - 2)
  const end = Math.max(30, (ts[ts.length - 1] ?? 0) + 10)
  const pts = [start, ...ts.filter((t) => t > start && t < end), end]
  const gaps: Gap[] = []
  for (let i = 0; i + 1 < pts.length; i++) if (pts[i + 1] - pts[i] > GAP_S) gaps.push({ t0: pts[i] + PAD, t1: pts[i + 1] - PAD })
  const linear = end - start - gaps.reduce((s, g) => s + g.t1 - g.t0, 0)
  const k = (1 - gaps.length * GAP_W) / linear // x per second outside gaps

  const tToX = (t: number) => {
    let x = 0, cur = start
    for (const g of gaps) {
      if (t <= g.t0) return Math.max(0, x + (t - cur) * k)
      x += (g.t0 - cur) * k
      if (t < g.t1) return x + ((t - g.t0) / (g.t1 - g.t0)) * GAP_W
      x += GAP_W
      cur = g.t1
    }
    return Math.min(1, x + (t - cur) * k)
  }
  const xToT = (x: number) => {
    x = Math.min(1, Math.max(0, x))
    let x0 = 0, cur = start
    for (const g of gaps) {
      const xg = x0 + (g.t0 - cur) * k
      if (x <= xg) return cur + (x - x0) / k
      if (x < xg + GAP_W) return g.t0 + ((x - xg) / GAP_W) * (g.t1 - g.t0)
      x0 = xg + GAP_W
      cur = g.t1
    }
    return Math.min(end, cur + (x - x0) / k)
  }
  return { start, end, gaps, tToX, xToT }
}
