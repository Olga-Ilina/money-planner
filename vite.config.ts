import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/money-planner/',
  build: {
    // ExcelJS is its own chunk, loaded only when the user imports or exports a file (src/ui/io.ts):
    // exceljs.min ≈ 930 kB minified (≈ 256 kB gzip), the largest chunk. The others, minified (measured
    // with vite 8.3): the app's entry chunk ≈ 199 kB, Chart.js (auto, loaded by the charts in «Отчёты»)
    // ≈ 202 kB, jszip ≈ 96 kB, importTracker ≈ 28 kB, backup ≈ 16 kB, reports ≈ 12 kB. The limit is the
    // smallest round value above ExcelJS, so the build stays warning-free while any other chunk growing
    // past 1000 kB is still reported. The service worker precaches them all (offline export).
    chunkSizeWarningLimit: 1000,
    // the licences of the bundled dependencies, next to index.html (not under .vite/): «О приложении» links
    // it and the service worker precaches it (the 'md' in globPatterns), so it opens offline too
    license: { fileName: 'licenses.md' },
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      // the icons in public/icons are precached by the glob below (dist/icons/*.png)
      manifest: {
        id: '/money-planner/',
        name: 'Трекер расходов',
        short_name: 'Расходы',
        lang: 'ru',
        display: 'standalone',
        start_url: '/money-planner/',
        scope: '/money-planner/',
        background_color: '#F2F2F7',
        theme_color: '#F2F2F7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,md}'],
        maximumFileSizeToCacheInBytes: 5_000_000,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // a zone far from UTC (+12/+13) so tests of local dates fail if code used the UTC date
    // (tests/ui/format.test.ts checks that it takes effect)
    env: { TZ: 'Pacific/Auckland' },
  },
});
