// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { PRESET } from '../../src/db/companion/wire';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';

/* v2.2 over the real MCP protocol: CTFs and selection on hackathons (ADR-072). */

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

const json = <T>(r: { json: unknown; isError: boolean; text: string }) => {
  if (r.isError) throw new Error(r.text);
  return r.json as T;
};

async function connect(t: TestCompanion, preset: 'full' | 'workspace') {
  const p = PRESET[preset];
  return mcpClient(
    t.companion.url,
    await t.grant({
      scope: p.scope,
      access: 'write',
      capabilities: p.capabilities,
      sensitive: p.sensitive,
      preset,
      label: 'Claude',
      clientKind: 'claude',
    }),
  );
}

type HackathonJson = { id: string; kind: string; selection?: string; start?: string };

describe('v2.2: hackathon kind and selection over MCP (ADR-072)', () => {
  it('creates a CTF, records the organisers’ answer and clears it', async () => {
    const t = await startTestCompanion();
    running.push(t);
    const claude = await connect(t, 'full');

    const ctf = json<HackathonJson>(
      await claude.call('create_hackathon', {
        name: 'Night CTF',
        kind: 'ctf',
        start: '2026-10-10',
        ppt: 'not_needed',
        selection: 'applied',
      }),
    );
    expect(ctf).toMatchObject({ kind: 'ctf', selection: 'applied', start: '2026-10-10' });

    const plain = json<HackathonJson>(
      await claude.call('create_hackathon', { name: 'Build Night' }),
    );
    expect(plain.kind).toBe('hackathon');
    expect(plain).not.toHaveProperty('selection');

    const shortlisted = json<HackathonJson>(
      await claude.call('update_hackathon', { hackathon: 'Night CTF', selection: 'shortlisted' }),
    );
    expect(shortlisted).toMatchObject({ kind: 'ctf', selection: 'shortlisted' });
    const cleared = json<HackathonJson>(
      await claude.call('update_hackathon', { hackathon: 'Night CTF', selection: 'none' }),
    );
    expect(cleared).not.toHaveProperty('selection');

    const refused = await claude.call('update_hackathon', { hackathon: 'Night CTF', kind: 'quiz' });
    expect(refused.isError).toBe(true);

    const listed = json<HackathonJson[]>(await claude.call('get_hackathons', {}));
    expect(listed.find((h) => h.id === ctf.id)?.kind).toBe('ctf');
    const context = await claude.call('get_context', {});
    expect(context.text).toMatch(/Night CTF \[CTF\] \(2026-10-10\)/);

    // Stored as the app stores it.
    const stored = await t.companion.store.hackathons.get(ctf.id);
    expect(stored).toMatchObject({ kind: 'ctf' });
    expect(stored).not.toHaveProperty('selection');
  });
});
