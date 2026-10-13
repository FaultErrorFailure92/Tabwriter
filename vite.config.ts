import { defineConfig } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    alphaTab({ assetOutputDir: false }),
    // offline support for the web version only (the desktop app ships everything itself)
    !isTauri &&
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icon-192.png', 'icon-512.png', 'font/*', 'soundfont/*', 'licenses/*'],
        manifest: {
          name: 'Stagecraft',
          short_name: 'Stagecraft',
          description: 'Von der Idee bis zur Bühne: Songs schreiben, arrangieren, Bühne planen, Setlists und Gigs',
          lang: 'de',
          start_url: './',
          scope: './',
          display: 'standalone',
          background_color: '#f4f3f0',
          theme_color: '#1d1d1f',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          file_handlers: [
            { action: './', accept: { 'application/octet-stream': ['.gp5', '.gp4', '.gp3', '.gp', '.gpx'] } },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,woff2,woff,otf,sf2,txt}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: 'index.html',
        },
      }),
  ],
  resolve: isTauri ? { alias: { 'virtual:pwa-register': '/src/pwa-stub.ts' } } : {},
  optimizeDeps: { exclude: ['@coderline/alphatab'] },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'safari15', chunkSizeWarningLimit: 2000 },
});
