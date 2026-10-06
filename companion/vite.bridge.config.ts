import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/*
 * Builds the stdio MCP bridge (companion/lowtide-mcp.ts) as plain JavaScript
 * for the installed runtime (v2.3): mcp/lowtide-mcp.js, built-ins only.
 * Runs after the companion build into the same folder, so it never empties it.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  publicDir: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: fileURLToPath(new URL('./lowtide-mcp.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: false,
    target: 'node22',
    sourcemap: false,
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: 'lowtide-mcp.js', format: 'es' },
    },
  },
});
