// @vitest-environment node
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { PRESET } from '../../src/db/companion/wire';
import { createRepositories } from '../../src/db/repositories';
import { startCompanion } from './app';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';

/* v2.2 over the real MCP protocol: the Areas section (ADR-071). */

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

describe('v2.2: Areas for a workspace connection (ADR-071)', () => {
  it('sees Areas and makes folders and pages in it, while Personal stays out of scope', async () => {
    const t = await startTestCompanion();
    running.push(t);
    // The app makes the sections when SPACE opens; the companion does at startup.
    await createRepositories(t.companion.store).space.ensureRoots();
    const workspace = await connect(t, 'workspace');

    const tree = json<{ tree: { title: string }[] }>(
      await workspace.call('get_space_tree', { depth: 1 }),
    );
    expect(tree.tree.map((n) => n.title)).toContain('Areas');
    expect(tree.tree.map((n) => n.title)).not.toContain('Personal');

    const folder = json<{ title: string; existing: boolean }>(
      await workspace.call('create_space_folder', { path: 'Areas / Engineering' }),
    );
    expect(folder).toMatchObject({ title: 'Engineering', existing: false });
    const page = json<{ id: string }>(
      await workspace.call('create_space_page', {
        path: 'Areas / Engineering / Learning plan',
        markdown: '## Now\n\n- Arrays',
      }),
    );
    const read = json<{ path: string; markdown: string }>(
      await workspace.call('get_space_page', { page: page.id }),
    );
    expect(read.path).toBe('Areas / Engineering / Learning plan');
    expect(read.markdown).toContain('Arrays');

    expect((await workspace.call('get_space_tree', { under: 'Personal' })).isError).toBe(true);
    expect(
      (await workspace.call('create_space_folder', { path: 'Personal / Notes' })).isError,
    ).toBe(true);
  });

  it('makes the Areas section at startup, before the app ever opens SPACE', async () => {
    const t = await startTestCompanion({ database: undefined } as never);
    await t.companion.close();
    // A database from before v2.2: every other section, but no Areas.
    const raw = new DatabaseSync(join(t.dataDir, 'lowtide.sqlite'));
    const removed = raw.prepare("DELETE FROM space_nodes WHERE key = 'areas'").run();
    raw.close();
    expect(removed.changes).toBe(1);
    const again = await startCompanion({ dataDir: t.dataDir, port: 0, syncDebounceMs: 10 });
    try {
      const roots = (await again.store.spaceNodes.toArray())
        .filter((n) => n.parentId === undefined)
        .map((n) => n.key);
      expect(roots).toContain('areas');
      expect(roots).toContain('lowtide');
    } finally {
      await again.close();
      rmSync(t.dataDir, { recursive: true, force: true });
    }
  });
});
