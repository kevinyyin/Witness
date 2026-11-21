import { create } from 'zustand'

/** Scene time `t` (s, 0 = impact): the single source of truth (D14). V2 adds playing/speed/mode/pinned/seekNonce. */
export const useTime = create<{ t: number; setT: (t: number) => void }>((set) => ({
  t: -20,
  setT: (t) => set({ t }),
}))
