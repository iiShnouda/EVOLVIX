import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// This build's number: written into the code and into /version.json, so an open app can tell a
// new version is on the server and update itself (src/lib/appUpdate.ts).
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

// The PWA is installable on every device, but for SECURITY it caches only the app SHELL
// (code/assets). Business data (the API responses under /api) is NEVER cached — the app
// is unusable without a live connection to the company server, by design.
export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'skb-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
      },
    },
    VitePWA({
      // The app decides when to take a new version: after keeping the open screens' work.
      registerType: 'prompt',
      injectRegister: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Explicitly never cache API data.
        // Downloads (the Android/Windows apps) must reach the server, not fall back to the app shell.
        navigateFallbackDenylist: [/^\/api/, /^\/downloads\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'Evolvix',
        short_name: 'Evolvix',
        description: 'Bilingual wholesale accounting, connected to your company server.',
        theme_color: '#4f46e5',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      // Bundle the shared package from TS source so the web build gets full ESM
      // tree-shaking and named exports (the published CJS build stays for the server).
      '@skb/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    // In split-server dev the app uses relative "/api"; forward it to the API on :5080.
    proxy: {
      '/api': { target: 'http://localhost:5080', changeOrigin: true },
      '/hubs': { target: 'http://localhost:5080', changeOrigin: true, ws: true },
    },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:5080', changeOrigin: true },
      '/hubs': { target: 'http://localhost:5080', changeOrigin: true, ws: true },
    },
  },
});
