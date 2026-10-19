import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/mcp': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/mcp': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  build: { outDir: 'dist' },
});
