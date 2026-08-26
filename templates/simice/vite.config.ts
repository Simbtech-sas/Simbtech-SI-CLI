import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Tauri serves the frontend from a fixed port and shows Rust errors itself.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'esnext', sourcemap: true },
});
