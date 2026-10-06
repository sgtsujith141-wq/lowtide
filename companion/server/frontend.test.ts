// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SERVED_MARKER } from './frontend';
import { startTestCompanion, type TestCompanion } from './test-fixtures';

/*
 * v2.3 (ADR-073): the companion serves the built app itself, so production
 * needs no Vite. Deep links get the page, hashed assets are cached, the
 * page never is, and nothing outside the app folder is ever served.
 */

const THEME = "\n      try { document.documentElement.dataset.t = '1'; } catch (e) {}\n    ";
const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function builtApp() {
  const dir = mkdtempSync(join(tmpdir(), 'lowtide-frontend-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html>\n<html>\n  <head>\n    <title>LOWTIDE</title>\n    <script>${THEME}</script>\n    <script type="module" src="/assets/index-abc123.js"></script>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`,
  );
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("app")');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return dir;
}

async function started(frontendDir?: string): Promise<TestCompanion> {
  const t = await startTestCompanion(frontendDir ? { frontendDir } : {});
  cleanups.push(() => t.close());
  return t;
}

/** A raw request, so the path reaches the server exactly as written. */
function raw(url: string, path: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the companion serves the built app (ADR-073)', () => {
  it('serves the page at / and on deep links, marked and never cached, with a strict policy', async () => {
    const t = await started(builtApp());
    for (const path of ['/', '/projects/engine', '/space?page=1', '/settings']) {
      const response = await fetch(`${t.companion.url}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const html = await response.text();
      expect(html).toContain(SERVED_MARKER);
      expect(html).toContain('<div id="root"></div>');
    }
    const page = await fetch(t.companion.url);
    const csp = page.headers.get('content-security-policy')!;
    const hash = createHash('sha256').update(THEME).digest('base64');
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
  });

  it('serves hashed assets for a year and other files fresh; missing files are 404', async () => {
    const t = await started(builtApp());
    const asset = await fetch(`${t.companion.url}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/text\/javascript/);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await asset.text()).toBe('console.log("app")');
    const icon = await fetch(`${t.companion.url}/favicon.svg`);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(`${t.companion.url}/assets/missing.js`)).status).toBe(404);
    const head = await fetch(`${t.companion.url}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('never serves anything outside the app folder', async () => {
    const t = await started(builtApp());
    for (const path of [
      '/../../../../etc/passwd',
      '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/assets/..%2f..%2f..%2fetc%2fpasswd',
      '/..%5c..%5cetc%5cpasswd',
    ]) {
      const { body } = await raw(t.companion.url, path);
      expect(body, path).not.toMatch(/root:/);
    }
  });

  it('keeps the API and MCP as they were, and allows the app’s own origin', async () => {
    const t = await started(builtApp());
    const health = await fetch(`${t.companion.url}/api/health`);
    expect(((await health.json()) as { app: string }).app).toBe('lowtide-companion');
    expect((await fetch(`${t.companion.url}/api/status`)).status).toBe(401);
    expect((await fetch(`${t.companion.url}/mcp`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${t.companion.url}/`, { method: 'POST' })).status).toBe(404);
    const own = await t.owner('/api/status', { headers: { origin: t.companion.url } });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { appUrl: string }).appUrl).toBe(`${t.companion.url}/`);
    const foreign = await t.owner('/api/status', { headers: { origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
  });

  it('serves no app when none is installed', async () => {
    const t = await started();
    expect((await fetch(`${t.companion.url}/`)).status).toBe(404);
    expect((await fetch(`${t.companion.url}/projects`)).status).toBe(404);
  });
});
