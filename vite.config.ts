import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/client', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Runs our Hono Worker (API + cron) locally via Miniflare, with the D1
    // binding, and bundles it for `wrangler deploy`. Reads wrangler.jsonc.
    cloudflare(),
    // Generates the PWA manifest and, via injectManifest, bundles our custom
    // service worker (src/client/sw.ts) that holds the push handlers.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        // The dashboard is small; allow generous precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Reading Tracker',
        short_name: 'Reading',
        description: 'Daily group book-reading tracker',
        lang: 'en',
        theme_color: '#4f46e5',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Let the SW work in `vite dev` too, so we can test push locally.
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
})
