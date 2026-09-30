import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/*
 * Builds the companion daemon for Node (npm run companion:build). Packages
 * stay external and load from node_modules at run time; only LOWTIDE's own
 * TypeScript (the shared domain code and the server) is bundled.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: false,
  logLevel: 'warn',
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
