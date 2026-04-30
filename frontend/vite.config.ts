/**
 * vite.config.ts
 * Blazen Sim frontend – Vite build configuration.
 * Proxies /api requests to the Express backend during development
 * to avoid CORS issues when running frontend and backend on separate ports.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path: string) => path,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
