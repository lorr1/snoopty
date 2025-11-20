import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  root: path.resolve(__dirname, 'client'),
  publicDir: path.resolve(__dirname, 'client', 'public'),
  base: '/ui/',
  build: {
    outDir: path.resolve(__dirname, 'dist', 'client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
