import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server proxies the API, auth handshake and event socket to the local
 * Fleet server so the browser only ever talks to one origin.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4500', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:4500', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:4500', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
