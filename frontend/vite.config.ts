import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { brand } from '@zuvo/config';
import { darkColors, lightColors } from '@zuvo/ui-tokens';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { buildOutput } from './bundling/chunks.ts';
import { APPLE_TOUCH_ICON, ICONS_DIR, MANIFEST_ICONS, splashLinkTags } from './pwa/assets.ts';
import { devPorts } from './src/lib/dev-ports.ts';
import { securityHeaders } from './src/lib/security-headers-plugin.ts';

/**
 * Dev and preview ports and the API behind the /v1 proxy: ZUVO_DEV_PORT, ZUVO_PREVIEW_PORT and
 * ZUVO_API_PORT from the environment or frontend/.env.local (the environment wins). Shared machine:
 * every developer picks their own. E2E points the proxy at the test API (ZUVO_API_TARGET).
 */
const PORTS = devPorts(loadEnv('', fileURLToPath(new URL('.', import.meta.url)), 'ZUVO_'));
const BACKEND = PORTS.apiTarget;

/** Fills brand placeholders and the iOS splash links in index.html — the brand lives only in brand.ts. */
function brandHtml(): Plugin {
  return {
    name: 'zuvo-brand-html',
    transformIndexHtml: (html) =>
      html
        .replaceAll('%BRAND_NAME%', brand.name)
        .replaceAll('%BRAND_DESCRIPTION%', brand.description)
        .replaceAll('%THEME_LIGHT%', lightColors.background)
        .replaceAll('%THEME_DARK%', darkColors.background)
        .replaceAll('%APPLE_TOUCH_ICON%', `/${ICONS_DIR}/${APPLE_TOUCH_ICON.file}`)
        .replace('<!-- PWA:SPLASH -->', splashLinkTags()),
  };
}

export default defineConfig({
  // A second dev server (E2E beside a running `pnpm dev`) must not share the dependency cache.
  ...(process.env.ZUVO_VITE_CACHE ? { cacheDir: process.env.ZUVO_VITE_CACHE } : {}),
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    brandHtml(),
    // CSP and the other security headers on dev and preview (shared/config/src/security-headers.ts).
    securityHeaders(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // We show our own "New version available" toast and register the worker ourselves.
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      injectManifest: {
        // Classic (IIFE) worker: widest browser support, and avoids the plugin's deprecated
        // `inlineDynamicImports` option, which it only sets for ES-module workers.
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Large or device-specific files stay out of the precache.
        globIgnores: ['icons/splash/**', 'screenshots/**'],
      },
      manifest: {
        id: '/',
        name: brand.name,
        short_name: brand.name,
        description: brand.description,
        start_url: '/chats',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        // A manifest has one theme/background color; index.html sets per-scheme theme-color.
        theme_color: brand.colors.primary,
        background_color: lightColors.background,
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'productivity', 'social'],
        icons: MANIFEST_ICONS.map((icon) => ({
          src: `/${ICONS_DIR}/${icon.file}`,
          sizes: `${icon.size}x${icon.size}`,
          type: 'image/png',
          purpose: icon.purpose,
        })),
        shortcuts: [
          {
            name: 'New chat',
            short_name: 'New chat',
            url: '/chats?new=1',
            icons: [{ src: `/${ICONS_DIR}/icon-192.png`, sizes: '192x192', type: 'image/png' }],
          },
        ],
        screenshots: [
          {
            src: '/screenshots/wide.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Chats and a conversation on desktop',
          },
          {
            src: '/screenshots/narrow.png',
            sizes: '780x1688',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Chat list on a phone',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Shown on Help → About.
  define: {
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // Fewer, bigger files for the first screen (bundling/chunks.ts, docs/runbooks/performance.md).
  build: { rolldownOptions: { output: buildOutput() } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Shared machine: never listen on public interfaces.
    host: '127.0.0.1',
    port: PORTS.dev,
    strictPort: true,
    // Same-origin in dev so session cookies just work.
    proxy: {
      '/v1': { target: BACKEND, changeOrigin: false },
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: PORTS.preview,
    strictPort: true,
    proxy: {
      '/v1': { target: BACKEND, changeOrigin: false },
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
});
