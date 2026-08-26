import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Everything is bundled. No CDN, no font host, no analytics beacon — an asset
  // fetched at runtime is a network call, and this app is not allowed any.
  build: {
    target: 'esnext',
    // Inline nothing above this and the app still needs sibling files, which is
    // fine — they ship together. What matters is that none come from a URL.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // PGlite ships a large WASM payload; keeping it in its own chunk means
        // the shell paints before the database engine is parsed.
        manualChunks(id) {
          return id.includes('@electric-sql/pglite') ? 'pglite' : undefined;
        },
      },
    },
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
})
