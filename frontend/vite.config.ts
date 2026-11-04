import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { brand } from '@zuvo/config';
import { defineConfig, type Plugin } from 'vite';

/** Dev server port. 5173/5175 are taken by other projects on this shared machine. */
export const DEV_PORT = 5191;
const BACKEND = 'http://127.0.0.1:4000';

/** Replaces %BRAND_NAME% / %BRAND_DESCRIPTION% in index.html — the brand lives only in brand.ts. */
function brandHtml(): Plugin {
  return {
    name: 'zuvo-brand-html',
    transformIndexHtml: (html) =>
      html
        .replaceAll('%BRAND_NAME%', brand.name)
        .replaceAll('%BRAND_DESCRIPTION%', brand.description)
        .replaceAll('%BRAND_PRIMARY%', brand.colors.primary),
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    brandHtml(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Shared machine: never listen on public interfaces.
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    // Same-origin in dev so session cookies just work.
    proxy: {
      '/v1': { target: BACKEND, changeOrigin: false },
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: DEV_PORT + 1,
    strictPort: true,
  },
});
