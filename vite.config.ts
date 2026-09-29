import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
