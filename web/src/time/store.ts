import { create } from 'zustand'

export type Mode = 'walk' | 'free'

type TimeState = {
  t: number // scene time (s, 0 = impact): the single source of truth (D14)
  playing: boolean
  speed: number // 0.25 | 1 | 4
  mode: Mode // Walkthrough (director camera) or Free (orbit)
  pinned: string | null // source id the reviewer pinned in the sidebar (V3)
  seekNonce: number // bumps on scrub/jump so the video re-seeks (V3)
  setT: (t: number) => void // scrub
  jump: (t: number, source?: string | null) => void // click a marker: go there, play, show its clip (or auto)
  toggle: () => void
  setSpeed: (s: number) => void
  setMode: (m: Mode) => void
  pin: (id: string | null) => void
}

export const useTime = create<TimeState>((set) => ({
  t: -20, playing: false, speed: 1, mode: 'walk', pinned: null, seekNonce: 0,
  setT: (t) => set((s) => ({ t, seekNonce: s.seekNonce + 1 })),
  jump: (t, source = null) => set((s) => ({ t, playing: true, pinned: source, seekNonce: s.seekNonce + 1 })),
  toggle: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed, playing: true }),
  setMode: (mode) => set({ mode }),
  pin: (pinned) => set({ pinned }),
}))
