import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // A device on the LAN needs to reach the dev server, so bind all interfaces.
    host: true,
    port: 5173,
  },
  build: {
    // Capacitor loads from the filesystem; sourcemaps make a device crash
    // report readable instead of a wall of minified frames.
    sourcemap: true,
  },
});
