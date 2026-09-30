// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/db/repositories';
import type { NotionSnapshot } from '../../src/db/import/notion/types';
import { fixturePlan, fixtureSnapshot } from '../../src/test/notion-fixture';
import { loadConfig } from './config';
import { loadSnapshot, runNotionImport } from './notion-import';
import { SqliteStore } from './sqlite/store';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** Writes a snapshot in the on-disk crawl format. */
function writeSnapshot(dir: string, snapshot: NotionSnapshot) {
  mkdirSync(join(dir, 'nodes'), { recursive: true });
  mkdirSync(join(dir, 'databases'), { recursive: true });
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ capturedAt: snapshot.capturedAt }));
  for (const page of snapshot.pages) {
    const { body, ...meta } = page;
    writeFileSync(join(dir, 'nodes', `${page.id}.json`), JSON.stringify({ kind: 'page', ...meta }));
    writeFileSync(join(dir, 'nodes', `${page.id}.md`), body);
  }
  for (const database of snapshot.databases) {
    writeFileSync(
      join(dir, 'databases', `${database.id}.json`),
      JSON.stringify({ kind: 'database', ...database }),
    );
  }
}

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'lowtide-notion-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const dataDir = join(base, 'data');
  const snapshotDir = join(base, 'snapshot');
  writeSnapshot(snapshotDir, fixtureSnapshot());
  const planFile = join(base, 'plan.json');
  writeFileSync(planFile, JSON.stringify(fixturePlan()));
  const workspaceDir = join(base, 'workspace');
  const run = (dryRun = false, now = '2026-02-10T12:00:00.000Z') =>
    runNotionImport({
      dataDir,
      snapshotDir,
      planFile,
      dryRun,
      workspaceDir,
      now: new Date(now),
      checkRunning: false,
    });
  const open = () => {
    const store = new SqliteStore(join(dataDir, 'lowtide.sqlite'));
    cleanups.push(() => store.close());
    return store;
  };
  return { base, dataDir, snapshotDir, planFile, workspaceDir, run, open };
}

describe('import-notion (companion CLI)', () => {
  it('reads the on-disk snapshot format back exactly', () => {
    const { snapshotDir } = setup();
    const loaded = loadSnapshot(snapshotDir);
    const original = fixtureSnapshot();
    expect(loaded.capturedAt).toBe(original.capturedAt);
    expect(loaded.pages.map((p) => [p.id, p.title, p.parentId, p.body]).sort()).toEqual(
      original.pages.map((p) => [p.id, p.title, p.parentId, p.body]).sort(),
    );
    expect(loaded.databases.find((d) => d.linkedView)?.id).toBe(original.databases.at(-1)!.id);
  });

  it('backs up first, imports into SQLite, reports, and writes the project’s SPACE into the workspace', async () => {
    const { run, open, workspaceDir, dataDir } = setup();
    // Existing LOWTIDE data that must survive.
    loadConfig(dataDir);
    const before = new SqliteStore(join(dataDir, 'lowtide.sqlite'));
    await createRepositories(before).tasks.create({ title: 'Mine' });
    before.close();

    const result = await run();
    expect(result.backupFiles).toHaveLength(2);
    for (const file of result.backupFiles) {
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    const backup = JSON.parse(readFileSync(result.backupFiles[1]!, 'utf8'));
    expect(backup.data.tasks.map((t: { title: string }) => t.title)).toEqual(['Mine']);
    expect(existsSync(result.reportFile)).toBe(true);

    const store = open();
    expect((await store.tasks.toArray()).map((t) => t.title)).toContain('Mine');
    expect(await store.projects.count()).toBe(2);
    expect(await store.spaceNodes.count()).toBeGreaterThan(10);

    const space = join(workspaceDir, 'projects/widget/space');
    const plan = readFileSync(join(space, 'planning/widget-plan.md'), 'utf8');
    expect(plan).toContain('Imported from Notion: Widget Plan');
    expect(plan).toContain('[Widget Spec](../architecture/widget-spec.md)');
    const table = readFileSync(join(space, 'tables/projects.md'), 'utf8');
    expect(table).toContain('| Project | Status |');
    expect(readFileSync(join(workspaceDir, 'projects/widget/CONTEXT.md'), 'utf8')).toContain(
      'space/planning/widget-plan.md',
    );
    // Nothing outside a project's own subtree is written.
    expect(readdirSync(workspaceDir)).not.toContain('space');
    expect(
      JSON.stringify(readdirSync(join(workspaceDir, 'projects'), { recursive: true })),
    ).not.toMatch(/graveyard|acme/i);
  });

  it('is idempotent across runs of the command', async () => {
    const { run, open } = setup();
    await run();
    const second = await run(false, '2026-02-11T12:00:00.000Z');
    expect(new Set(second.report.entities.map((e) => e.action))).toEqual(
      new Set(['unchanged', 'provenance']),
    );
    const store = open();
    expect(await store.projects.count()).toBe(2);
  });

  it('writes nothing on a dry run', async () => {
    const { run, open, workspaceDir } = setup();
    const result = await run(true);
    expect(result.report.dryRun).toBe(true);
    expect(result.backupFiles).toEqual([]);
    const store = open();
    expect(await store.projects.count()).toBe(0);
    expect(await store.spaceNodes.count()).toBe(0);
    expect(existsSync(join(workspaceDir, 'projects'))).toBe(false);
  });

  it('refuses while the companion is running', async () => {
    const { dataDir, snapshotDir, planFile } = setup();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => server.close());
    const port = (server.address() as { port: number }).port;
    loadConfig(dataDir);
    const configFile = join(dataDir, 'companion.json');
    writeFileSync(
      configFile,
      JSON.stringify({ ...JSON.parse(readFileSync(configFile, 'utf8')), port }),
    );
    await expect(
      runNotionImport({ dataDir, snapshotDir, planFile, dryRun: false }),
    ).rejects.toThrow(/companion is running/);
  });

  it('can’t write to Notion: nothing on the import path talks to it', () => {
    const files = [
      ...readdirSync(join(__dirname, '../../src/db/import/notion')).map((f) =>
        join(__dirname, '../../src/db/import/notion', f),
      ),
      join(__dirname, 'notion-import.ts'),
    ];
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /\bfetch\(|XMLHttpRequest|node:https?\b|api\.notion|notion-(create|update|move|delete)/,
      );
    }
  });
});
