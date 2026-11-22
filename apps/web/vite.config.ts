import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(({ mode }) => ({
  root,
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 5173),
    proxy: { '/api': 'http://127.0.0.1:3000', '/auth': 'http://127.0.0.1:3000' },
  },
  build: {
    outDir: fileURLToPath(new URL(mode === 'preview' ? '../../studio' : '../../dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
}));
