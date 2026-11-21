import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Prep data folder (videos etc.). Never in git; served only by the dev server under /media/.
const DATA = path.resolve(process.env.WITNESS_DATA ?? path.join(here, '..', 'data'))

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
}

// /media/<path under WITNESS_DATA> with HTTP range support so <video> can seek.
function media(): Plugin {
  return {
    name: 'witness-media',
    configureServer(server) {
      server.middlewares.use('/media', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
        const file = path.resolve(DATA, '.' + rel)
        if (!file.startsWith(DATA + path.sep)) return next()
        let stat: fs.Stats
        try { stat = fs.statSync(file) } catch { return next() }
        if (!stat.isFile()) return next()
        const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
        if (m) {
          const start = m[1] ? Number(m[1]) : 0
          const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1, 'Content-Type': type,
          })
          fs.createReadStream(file, { start, end }).pipe(res)
        } else {
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' })
          fs.createReadStream(file).pipe(res)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), media()],
  server: {
    proxy: {
      // Spec §9.3 paths are /analyze, /judge, /health on the pipeline server.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  test: { environment: 'node' },
} as any)
