import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function mediaProxyPlugin(): Plugin {
  return {
    name: 'streamstudio-media-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/media-proxy')) {
          next()
          return
        }

        try {
          const requestUrl = new URL(req.url, 'http://localhost')
          const remoteUrl = requestUrl.searchParams.get('url')

          if (!remoteUrl) {
            res.statusCode = 400
            res.end('Missing url parameter')
            return
          }

          const response = await fetch(remoteUrl, {
            headers: {
              'User-Agent': 'StreamStudio/1.0',
              Accept: 'image/*,video/*,*/*',
            },
          })

          if (!response.ok) {
            res.statusCode = response.status
            res.end('Failed to fetch remote media')
            return
          }

          const buffer = Buffer.from(await response.arrayBuffer())
          const contentType = response.headers.get('content-type') || 'application/octet-stream'

          res.setHeader('Content-Type', contentType)
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end(buffer)
        } catch {
          res.statusCode = 502
          res.end('Media proxy error')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), mediaProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      // Device mirror writes under backend/tmp; never full-reload the SPA for that.
      ignored: ['**/backend/**', '**/backend/.venv/**'],
    },
    proxy: {
      // Local extract API (uvicorn on :8080). Start with: cd backend && uvicorn app.main:app --port 8080
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true,
        // Live device streams must not be buffered by the proxy.
        timeout: 0,
        proxyTimeout: 0,
      },
      '/media': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
