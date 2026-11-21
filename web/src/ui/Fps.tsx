import { useEffect, useState } from 'react'
import { frameStats } from '../scene/Scene'

/** Big FPS readout (§7.1.8 #9: ≥ 30 fps on the demo laptop), readable from a metre away. */
export function Fps({ points }: { points: number }) {
  const [fps, setFps] = useState(0)
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
  return (
    <div className="fps" style={{ color: fps >= 30 ? 'var(--green)' : 'var(--red)' }}>
      FPS {fps} · {Math.round(points / 1000)}k pts
    </div>
  )
}
