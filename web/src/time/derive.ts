// Pure functions of scene time t (s, 0 = impact). Scrubbing backward just re-evaluates them (§7.1.5).

/** Target heat 0..1: calm before impact, white → amber → red over 1.5 s, then stays red (§7.1.2). */
export const heatAt = (t: number) => (t <= 0 ? 0 : Math.min(1, t / 1.5))

/** Impact flash intensity: 1 at t = 0, gone by +0.6 s. */
export const flashAt = (t: number) => (t < 0 || t > 0.6 ? 0 : 1 - t / 0.6)
