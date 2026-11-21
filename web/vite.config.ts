import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream'
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
        // Only media types: the data folder also holds answer keys and rights-pending downloads.
        const type = TYPES[path.extname(file).toLowerCase()]
        if (!type || !file.startsWith(DATA + path.sep)) return next()
        let stat: fs.Stats
        try { stat = fs.statSync(file) } catch { return next() }
        if (!stat.isFile()) return next()
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
        if (m) {
          const start = m[1] ? Number(m[1]) : 0
          const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1, 'Content-Type': type,
          })
          // pipeline closes the file when the browser aborts (every seek) and swallows read errors.
          pipeline(fs.createReadStream(file, { start, end }), res, () => {})
        } else {
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' })
          pipeline(fs.createReadStream(file), res, () => {})
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
