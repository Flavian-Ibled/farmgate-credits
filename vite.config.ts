import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwind()],
  resolve: { preserveSymlinks: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: '../dist', emptyOutDir: true },
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 120000, hookTimeout: 120000 },
} as any);
