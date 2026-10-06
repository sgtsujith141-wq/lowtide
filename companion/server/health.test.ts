// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { LOWTIDE_VERSION } from '../../src/lib/version';
import { startTestCompanion, type TestCompanion } from './test-fixtures';

/* v2.3: machine-readable health for the launcher, the installer and people. */

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

describe('health (v2.3)', () => {
  it('reports every part of LOWTIDE, without secrets or paths', async () => {
    const t = await startTestCompanion();
    running.push(t);
    const response = await fetch(`${t.companion.url}/api/health`);
    expect(response.status).toBe(200);
    const text = await response.text();
    const health = JSON.parse(text) as {
      app: string;
      version: string;
      status: string;
      checks: Record<string, { ok: boolean }>;
    };
    expect(health).toMatchObject({
      app: 'lowtide-companion',
      version: LOWTIDE_VERSION,
      status: 'ok',
    });
    expect(Object.keys(health.checks).sort()).toEqual(
      ['api', 'database', 'frontend', 'mcp', 'runtime', 'sse', 'workspace'].sort(),
    );
    expect(health.checks.database).toMatchObject({ ok: true, integrity: 'ok', schemaVersion: 11 });
    expect(text).not.toContain(t.ownerToken);
    expect(text).not.toContain(t.dataDir);
    expect(text).not.toMatch(/token/i);
  });

  it('is degraded when an installed runtime has lost its app', async () => {
    const t = await startTestCompanion({ frontendDir: '/nonexistent', requireFrontend: true });
    running.push(t);
    const health = (await (await fetch(`${t.companion.url}/api/health`)).json()) as {
      status: string;
      checks: { frontend: { ok: boolean; served: boolean } };
    };
    expect(health.status).toBe('degraded');
    expect(health.checks.frontend).toEqual({ ok: false, served: false });
  });
});
