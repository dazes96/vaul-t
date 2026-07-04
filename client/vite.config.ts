import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-time proxy: Vite serves the UI, the Emerald server owns /api and /ws.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4621,
    proxy: {
      '/api': 'http://127.0.0.1:4620',
      '/ws': { target: 'ws://127.0.0.1:4620', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000, // monaco is intentionally bundled for offline use
  },
});
