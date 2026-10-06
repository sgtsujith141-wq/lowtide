import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

/*
 * The built LOWTIDE app, served by the companion itself (v2.3, ADR-073), so
 * production needs no Vite: one process on 127.0.0.1 serves the app, its
 * API, live events and MCP. Hashed assets are cached for a year; the page
 * itself never is. Any path that isn't a file gets the page (deep links);
 * a missing file with an extension is a 404. The page is marked as served
 * by the companion, so the app connects to it instead of browser storage.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export const SERVED_MARKER = '<meta name="lowtide-served-by" content="companion" />';

export interface Frontend {
  dir: string;
  /** Serves a GET/HEAD for the app; false when the path isn't the app's. */
  serve(req: IncomingMessage, res: ServerResponse, path: string): boolean;
}

function headersFor(csp: string): Record<string, string> {
  return {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
  };
}

/** Loads the built app from `dir` (its index.html and assets); undefined if it isn't there. */
export function loadFrontend(dir: string | undefined): Frontend | undefined {
  if (!dir || !existsSync(join(dir, 'index.html'))) return undefined;
  const root = realpathSync(dir);
  const source = readFileSync(join(root, 'index.html'), 'utf8');
  // Inline scripts (the theme script) are allowed by their hash, nothing else inline.
  const hashes = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`,
  );
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const page = Buffer.from(source.replace('<head>', `<head>\n    ${SERVED_MARKER}`), 'utf8');
  const pageHeaders = {
    'content-type': TYPES['.html']!,
    'cache-control': 'no-cache',
    ...headersFor(csp),
  };

  function sendPage(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { ...pageHeaders, 'content-length': String(page.length) });
    res.end(req.method === 'HEAD' ? undefined : page);
  }

  return {
    dir: root,
    serve(req, res, path) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      if (path === '/api' || path.startsWith('/api/') || path === '/mcp') return false;
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        return false;
      }
      if (decoded.includes('\0')) return false;
      const relative = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
      const file = join(root, relative);
      if (file !== root && !file.startsWith(root + sep)) return false;
      if (relative === sep || relative === '.' || relative === '/index.html') {
        sendPage(req, res);
        return true;
      }
      let stat: ReturnType<typeof statSync> | undefined;
      try {
        stat = statSync(file);
      } catch {
        stat = undefined;
      }
      if (stat?.isFile()) {
        const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
        const immutable = relative.startsWith(`${sep}assets${sep}`);
        const body = readFileSync(file);
        res.writeHead(200, {
          'content-type': type,
          'content-length': String(body.length),
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
          'x-content-type-options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
      }
      // A route of the app (deep link): the page; a missing file: not the app's.
      if (extname(relative)) return false;
      sendPage(req, res);
      return true;
    },
  };
}
