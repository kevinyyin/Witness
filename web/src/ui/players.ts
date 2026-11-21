// Video player plumbing for the sidebar (§7.1.7). No React here.
import type { Source } from '../types'

export type Kind = 'youtube' | 'file' | 'embed'

/** `player` if the JSON has it; else from embed_url (PLAN gap 3). */
export function playerKind(s: Source): Kind {
  if (s.player) return s.player
  const u = s.embed_url ?? ''
  if (youtubeId(u)) return 'youtube'
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u) || u.startsWith('/media/')) return 'file'
  return 'embed'
}

export const youtubeId = (u: string) => /(?:youtube\.com\/embed\/|youtu\.be\/|[?&]v=)([\w-]{11})/.exec(u)?.[1] ?? null

/** Only real web pages go into an iframe (the §9.2 example uses "…" placeholders). */
export const embeddable = (u: string | undefined) => !!u && /^https:\/\//.test(u)

export type Adapter = { time(): number; seek(s: number): void; play(): void; pause(): void; rate(r: number): void; destroy(): void }

export function videoAdapter(v: HTMLVideoElement): Adapter {
  return {
    time: () => v.currentTime,
    seek: (s) => { v.currentTime = s },
    play: () => { if (v.paused) v.play().catch(() => {}) },
    pause: () => { if (!v.paused) v.pause() },
    rate: (r) => { if (v.playbackRate !== r) v.playbackRate = r },
    destroy: () => v.pause(),
  }
}

let yt: Promise<any> | null = null
export function loadYouTube(): Promise<any> {
  const w = window as any
  if (w.YT?.Player) return Promise.resolve(w.YT)
  return (yt ??= new Promise((resolve) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  }))
}

export function youtubeAdapter(p: any): Adapter {
  return {
    time: () => p.getCurrentTime?.() ?? 0,
    seek: (s) => p.seekTo(s, true),
    play: () => { if (p.getPlayerState() !== 1) p.playVideo() },
    pause: () => { if (p.getPlayerState() === 1) p.pauseVideo() },
    // YouTube allows a fixed set (max 2x): take the fastest allowed rate ≤ r; drift correction covers 4x.
    rate: (r) => {
      const ok: number[] = p.getAvailablePlaybackRates?.() ?? [1]
      const best = ok.filter((x) => x <= r).pop() ?? ok[0]
      if (p.getPlaybackRate() !== best) p.setPlaybackRate(best)
    },
    destroy: () => p.destroy(),
  }
}
