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
      // The server rejects foreign Host/Origin headers, so the dev proxy presents itself as the server's origin.
      '/api': { target: 'http://127.0.0.1:4500', changeOrigin: true, headers: { origin: 'http://127.0.0.1:4500' } },
      '/auth': { target: 'http://127.0.0.1:4500', changeOrigin: true, headers: { origin: 'http://127.0.0.1:4500' } },
      '/ws': { target: 'ws://127.0.0.1:4500', ws: true, changeOrigin: true, headers: { origin: 'http://127.0.0.1:4500' } },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
