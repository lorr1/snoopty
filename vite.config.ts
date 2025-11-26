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
  optimizeDeps: {
    exclude: ['@anthropic-ai/tokenizer'],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist', 'client'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-tokenizer': ['@anthropic-ai/tokenizer'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
