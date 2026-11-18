import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `npm run dev:stub` swaps Firebase for an in-memory fake so the UI can be tried without signing in.
export default defineConfig(({ mode }) => ({
  base: './',
  build: { chunkSizeWarningLimit: 1600 },
  plugins: [react()],
  resolve: {
    alias: mode === 'stub' ? { './cloud': fileURLToPath(new URL('./src/cloud.stub.ts', import.meta.url)) } : {},
  },
}));
