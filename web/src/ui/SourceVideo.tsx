// §7.1.7 #1 Source video (MUST): the clip covering the playhead, seeked to t − offset_s.
import { useEffect, useRef, useState } from 'react'
import type { Incident, Source } from '../types'
import { useTime } from '../time/store'
import { alsoCovering, fmtT, mmss, pickClip, slowmo } from '../time/derive'
import { embeddable, loadYouTube, videoAdapter, youtubeAdapter, youtubeId, type Adapter } from './players'

/** Keeps a seekable player on the scene clock: re-seek on scrub/jump or drift > 0.5 s; rate follows playback. */
function useSync(src: Source, get: () => Adapter | null) {
  useEffect(() => {
    let nonce = -1
    const id = setInterval(() => {
      const a = get(), s = useTime.getState()
      if (!a || src.offset_s == null) return
      const clipTs = s.t - src.offset_s, force = s.seekNonce !== nonce
      nonce = s.seekNonce
      if (clipTs < 0) { a.pause(); if (force) a.seek(0); return }
      // past the clip's end: hold the last frame (play() on an ended video restarts it from 0, forever)
      if (clipTs > src.duration_s) { a.pause(); if (force) a.seek(Math.max(0, src.duration_s - 0.05)); return }
      if (force || Math.abs(a.time() - clipTs) > 0.5) a.seek(clipTs)
      a.rate(s.speed * (s.mode === 'walk' ? slowmo(s.t) : 1))
      if (s.playing) a.play(); else a.pause()
    }, 250)
    return () => clearInterval(id)
  }, [src, get])
}

function FilePlayer({ src, muted }: { src: Source; muted?: boolean }) {
  const v = useRef<HTMLVideoElement>(null)
  const a = useRef<Adapter | null>(null)
  useEffect(() => { a.current = v.current && videoAdapter(v.current); return () => a.current?.destroy() }, [])
  useSync(src, useRef(() => a.current).current)
  // offset_s null = not placed in time: no sync, so the reviewer plays it by hand
  return <video ref={v} src={src.media_url ?? undefined} playsInline preload="auto" controls={src.offset_s == null} muted={muted} />
}

function YouTubePlayer({ src }: { src: Source }) {
  const box = useRef<HTMLDivElement>(null)
  const a = useRef<Adapter | null>(null)
  useEffect(() => {
    let alive = true
    loadYouTube().then((YT) => {
      if (!alive || !box.current) return
      const p = new YT.Player(box.current, {
        videoId: youtubeId(src.embed_url ?? ''), playerVars: { playsinline: 1, rel: 0 },
        events: { onReady: () => { if (alive) a.current = youtubeAdapter(p) } },
      })
    })
    return () => { alive = false; a.current?.destroy(); a.current = null }
  }, [src])
  useSync(src, useRef(() => a.current).current)
  return <div ref={box} />
}

/** `player: "embed"` (or a youtube/file source whose URL is still a placeholder): not seekable, the moment is printed. */
function EmbedPlayer({ src }: { src: Source }) {
  const t = useTime((s) => Math.round(s.t * 10) / 10)
  const clipTs = src.offset_s == null ? null : t - src.offset_s
  return (
    <>
      {src.player === 'embed' && embeddable(src.embed_url) ? <iframe src={src.embed_url!} allow="autoplay; encrypted-media" /> : <div className="no-embed muted">no playable video for clip {src.id}{embeddable(src.url) && <> · <a href={src.url!} target="_blank" rel="noreferrer">open source ↗</a></>}</div>}
      <div className="moment">
        {clipTs == null ? 'clip not aligned: moment unknown'
          : clipTs < 0 ? `clip ${src.id} starts at t = ${fmtT(src.offset_s!)}`
          : `▸ this moment is at ${mmss(clipTs)} in clip ${src.id} (embed can't seek)`}
      </div>
    </>
  )
}

const STATUS = { real: '✓ real', unsure: '⚠ unsure', fake: '✗ rejected' }

/** The player that can actually run: a youtube/file source whose URL is still "…" falls back to printing the moment. */
function kindOf(s: Source) {
  if (s.player === 'youtube' && youtubeId(s.embed_url ?? '')) return 'youtube'
  if (s.player === 'file' && s.media_url && s.media_url !== '…') return 'file'
  return 'embed'
}

export function SourceVideo({ inc }: { inc: Incident }) {
  const id = useTime((s) => pickClip(inc, s.t, s.pinned)?.id ?? null)
  const pinned = useTime((s) => s.pinned)
  // ids as one string, so the sidebar re-renders only when the set of clips changes
  const also = useTime((s) => alsoCovering(inc, s.t, id).filter((o) => kindOf(o) === 'file' && (o.graphic_level ?? 0) < 2).map((o) => o.id).join(','))
  const [unblurred, setUnblurred] = useState<Record<string, boolean>>({})
  const src = inc.sources.find((s) => s.id === id) ?? null
  const kind = src && kindOf(src)
  const blurred = !!src && (src.graphic_level ?? 0) >= 2 && !unblurred[src.id] // §7.1.9: never autoplay graphic ≥ 2 unblurred

  return (
    <section>
      <h4>
        ▶ SOURCE VIDEO{src && <> · clip {src.id} · {src.platform} · {STATUS[src.authenticity]}</>}
        {' '}{pinned ? <button className="mini" onClick={() => useTime.getState().pin(null)}>pinned {pinned} · back to auto</button> : <span className="muted">(auto)</span>}
      </h4>
      <div className={`video-box ${blurred ? 'blurred' : ''}`}>
        {!src ? <div className="no-embed muted">No source clip covers this moment.</div>
          : kind === 'file' ? <FilePlayer key={src.id} src={src} />
          : kind === 'youtube' ? <YouTubePlayer key={src.id} src={src} />
          : <EmbedPlayer key={src.id} src={src} />}
        {blurred && (
          <div className="blur-cover">
            Graphic content (level {src!.graphic_level}) · blurred
            <button onClick={() => setUnblurred((u) => ({ ...u, [src!.id]: true }))}>Show anyway</button>
          </div>
        )}
      </div>
      {also && also.split(',').map((oid) => {
        const o = inc.sources.find((s) => s.id === oid)!
        return ( // a second camera on the same moment, silent so the two soundtracks do not overlap; click = make it the main clip
          <div key={oid} className="video-box also" onClick={() => useTime.getState().pin(oid)} title={`Pin clip ${oid}`}>
            <FilePlayer src={o} muted />
            <span className="also-tag">clip {oid} · same moment, another camera</span>
          </div>
        )
      })}
      {src && src.findings.length > 0 && (
        <div className="findings">
          {src.findings.map((f, i) => (
            // §9.2: findings carry clip_ts only, so their scene time is t = clip_ts + offset_s.
            <button key={i} className="mini" disabled={src.offset_s == null}
              onClick={() => useTime.getState().jump(f.clip_ts + (src.offset_s ?? 0), src.id)}>
              {mmss(f.clip_ts)} {f.label} ▸
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
