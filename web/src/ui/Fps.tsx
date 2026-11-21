import { useEffect, useState } from 'react'
import { frameStats } from '../scene/Scene'

/** Big FPS readout (§7.1.8 #9: ≥ 30 fps on the demo laptop), readable from a metre away. */
export function Fps({ points }: { points: number }) {
  const [fps, setFps] = useState(0)
  const [hidden, setHidden] = useState(true) // hidden by default (cramped); F shows it for the 30 fps check
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'f' || e.key === 'F') setHidden((h) => !h) } // F: hide for video capture
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  useEffect(() => {
    let frames = frameStats.frames, t = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      setFps(Math.round(((frameStats.frames - frames) * 1000) / (now - t)))
      frames = frameStats.frames
      t = now
    }, 500)
    return () => clearInterval(id)
  }, [])
  if (hidden) return null
  return (
    <div className="fps" style={{ color: fps >= 30 ? 'var(--text)' : 'var(--red)' }}>
      FPS {fps} · {Math.round(points / 1000)}k pts
    </div>
  )
}
