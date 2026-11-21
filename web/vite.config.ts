import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// §9.3: FastAPI on 127.0.0.1:8000, every route starts with /api; the browser never calls it cross-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
})
