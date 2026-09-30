// @vitest-environment node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/db/repositories';
import { GENERATED_MARK } from '../../src/features/context/workspace';
import { SqliteStore } from './sqlite/store';
import { PathError, WORKSPACE_GITIGNORE, WorkspaceSync } from './workspace-sync';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'lowtide-ws-'));
  const dir = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.md'), 'not for AI clients');
  const store = new SqliteStore(':memory:');
  const repositories = createRepositories(store, { watch: store.watch });
  const sync = new WorkspaceSync(store, repositories, dir, () => new Date(), 5);
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  cleanups.push(() => sync.stop());
  return { sync, repositories, store, root: sync.root, outside };
}

const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

describe('the live technical workspace (ADR-060)', () => {
  it('generates project files with a marker and follows every change without a re-export', async () => {
    const { sync, repositories, root } = setup();
    await sync.start();
    const project = await repositories.projects.create({ name: 'Engine', objective: 'Ship it' });
    await sync.sync();
    for (const path of ['PROJECT.md', 'CONTEXT.md']) {
      expect(read(root, `projects/engine/${path}`).startsWith(GENERATED_MARK)).toBe(true);
    }
    for (const folder of [
      'planning',
      'decisions',
      'research',
      'docs',
      'files',
      'assets',
      'ai/sessions',
      'ai/handoffs',
      'ai/summaries',
      'archive',
    ]) {
      expect(existsSync(join(root, 'projects/engine', folder)), folder).toBe(true);
    }
    for (const folder of ['hackathons', 'shared', 'archive'])
      expect(existsSync(join(root, folder))).toBe(true);

    // A change lands in the files by itself (debounced), no export step.
    await repositories.projects.update(project.id, { nextAction: 'Wire the bus' });
    await expect
      .poll(() => read(root, 'projects/engine/PROJECT.md'), { timeout: 2000 })
      .toContain('Wire the bus');

    // Notes land in their own folders, never in the generated context files.
    await repositories.notes.create(project.id, {
      kind: 'handoff',
      title: 'Pick up',
      body: 'Start here.',
    });
    const report = await sync.sync();
    const handoff = report.written.find((p) => p.startsWith('projects/engine/ai/handoffs/'));
    expect(handoff).toBeDefined();
    expect(read(root, handoff!)).toContain('Start here.');
  });

  it('never modifies or deletes a person’s files, and reports a clash instead', async () => {
    const { sync, repositories, root } = setup();
    const project = await repositories.projects.create({ name: 'Engine' });
    await sync.sync();
    writeFileSync(join(root, 'projects/engine/docs/plan.md'), '# My plan');
    writeFileSync(join(root, 'projects/engine/PROJECT.md'), '# I rewrote this by hand');

    await repositories.projects.update(project.id, { phase: 'Beta' });
    const report = await sync.sync();
    expect(report.conflicts).toEqual(['projects/engine/PROJECT.md']);
    expect(read(root, 'projects/engine/PROJECT.md')).toBe('# I rewrote this by hand');
    expect(read(root, 'projects/engine/docs/plan.md')).toBe('# My plan');

    // Archiving moves the generated files; the person's files stay where they are.
    await repositories.projects.setState(project.id, 'archived');
    const moved = await sync.sync();
    expect(moved.written).toContain('archive/projects/engine/PROJECT.md');
    expect(moved.removed).toContain('projects/engine/CONTEXT.md');
    expect(moved.removed).not.toContain('projects/engine/PROJECT.md');
    expect(read(root, 'projects/engine/docs/plan.md')).toBe('# My plan');
    expect(read(root, 'projects/engine/PROJECT.md')).toBe('# I rewrote this by hand');

    // The person's documents are listed in CONTEXT.md, not copied.
    expect(read(root, 'archive/projects/engine/CONTEXT.md')).not.toContain('My plan');
  });

  it('refuses traversal, absolute paths, bookkeeping and links that leave the workspace', async () => {
    const { sync, repositories, root, outside } = setup();
    await repositories.projects.create({ name: 'Engine' });
    await repositories.projects.create({ name: 'Other' });
    await sync.sync();
    symlinkSync(outside, join(root, 'projects/engine/docs/escape'));
    symlinkSync(join(outside, 'secret.md'), join(root, 'shared/secret.md'));

    const refused = [
      '../outside/secret.md',
      'projects/../../outside/secret.md',
      join(outside, 'secret.md'),
      'projects/engine/docs/escape/secret.md',
      'shared/secret.md',
      '.lowtide/manifest.json',
      'projects/engine/.lowtide/summary.json',
      'projects/engine/\0x',
    ];
    for (const path of refused) expect(() => sync.read(path), path).toThrow(PathError);
    const engineOnly = { kind: 'project' as const, root: 'projects/engine' };
    expect(() => sync.read('projects/other/PROJECT.md', engineOnly)).toThrow(PathError);
    expect(sync.read('projects/engine/PROJECT.md', engineOnly)).toContain('Engine');

    const listed = sync.list();
    expect(listed.some((p) => p.includes('secret'))).toBe(false);
    expect(listed.some((p) => p.includes('.lowtide'))).toBe(false);
    expect(sync.list(engineOnly).every((p) => p.startsWith('projects/engine/'))).toBe(true);
  });

  it('initialises a private Git repository with no remote and no commits', async () => {
    const { sync, root } = setup();
    await sync.sync();
    expect(await sync.gitStatus()).toEqual({ repository: false, remotes: [], changes: 0 });
    const status = await sync.gitInit();
    expect(status.repository).toBe(true);
    expect(status.remotes).toEqual([]);
    expect(status.changes).toBeGreaterThan(0);
    expect(read(root, '.gitignore')).toBe(WORKSPACE_GITIGNORE);
    expect(WORKSPACE_GITIGNORE).toMatch(/\*\.sqlite/);
    expect(WORKSPACE_GITIGNORE).toMatch(/lowtide-backup\*\.json/);
    expect(() =>
      execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, stdio: 'pipe' }),
    ).toThrow();
    // Running it again changes nothing and still adds no remote.
    expect((await sync.gitInit()).remotes).toEqual([]);
  });
});
