import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/*
 * Builds the companion daemon for Node (npm run companion:build) as one
 * self-contained file: LOWTIDE's own TypeScript and every package it uses
 * are bundled, so the built companion needs only Node and its built-in
 * modules, never this repository's node_modules (v2.3, ADR-073).
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: fileURLToPath(new URL('./server/main.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: 'lowtide-companion.js', format: 'es' },
    },
  },
});
