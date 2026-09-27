import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The PWA is installable on every device, but for SECURITY it caches only the app SHELL
// (code/assets). Business data (the API responses under /api) is NEVER cached — the app
// is unusable without a live connection to the company server, by design.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Explicitly never cache API data.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
      },
      manifest: {
        name: 'SKB — Wholesale Accounting',
        short_name: 'SKB',
        description: 'Bilingual wholesale accounting, connected to your company server.',
        theme_color: '#4f46e5',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'any',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
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
  },
  preview: {
    port: 4173,
    host: true,
  },
});
