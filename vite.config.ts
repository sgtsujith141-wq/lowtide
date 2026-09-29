import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Vendors in their own long-lived chunks: app updates don't re-download
        // React or the data layer, and no chunk crosses the 500 kB warning.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/ },
            { name: 'data', test: /node_modules[\\/](dexie|zod)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // Cold starts (first lazy-screen import, first ESLint run) can exceed the 5 s
    // default on a slow or just-woken disk. Real hangs still fail.
    testTimeout: 15_000,
    // Half the cores: UI tests over fake IndexedDB are CPU-heavy, and one worker
    // per core made them compete (and time out) on a busy machine.
    maxWorkers: '50%',
  },
});
