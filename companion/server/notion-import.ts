import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRepositories } from '../../src/db/repositories';
import { importNotion, parsePlan, type ImportReport } from '../../src/db/import/notion/importer';
import type { NotionDatabase, NotionPage, NotionSnapshot } from '../../src/db/import/notion/types';
import { loadConfig } from './config';
import { SqliteStore } from './sqlite/store';
import { WorkspaceSync } from './workspace-sync';

/*
 * `lowtide-companion import-notion` (ADR-062): brings a Notion snapshot into
 * the canonical SQLite database, offline, while the companion is stopped.
 *
 *   1. refuses if the companion is running (one process owns the database);
 *   2. backs up first: an exact SQLite copy and a LOWTIDE backup file;
 *   3. imports in one transaction (a dry run rolls back);
 *   4. writes the report next to the backups and regenerates the workspace.
 *
 * The snapshot and plan are the owner's files in the data folder. Nothing
 * here talks to Notion.
 */

/** Reads a snapshot folder: nodes/<id>.json + .md, databases/<id>.json. */
export function loadSnapshot(dir: string): NotionSnapshot {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const pages: NotionPage[] = [];
  for (const file of readdirSync(join(dir, 'nodes'))
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const raw = read(join(dir, 'nodes', file));
    const id = str(raw.id)!;
    const md = join(dir, 'nodes', `${id}.md`);
    const parentKind =
      raw.parentKind === 'page' || raw.parentKind === 'database' ? raw.parentKind : null;
    pages.push({
      id,
      url: str(raw.url) ?? `https://app.notion.com/p/${id}`,
      title: str(raw.title) ?? '',
      icon: str(raw.icon) ?? null,
      parentId: str(raw.parentId) ?? null,
      parentKind,
      body: existsSync(md) ? readFileSync(md, 'utf8') : '',
      properties: (raw.properties as Record<string, unknown>) ?? {},
      lastEditedAt: str(raw.lastEditedAt) ?? null,
      truncated: raw.truncated === true,
    });
  }
  const databases: NotionDatabase[] = [];
  for (const file of readdirSync(join(dir, 'databases'))
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const raw = read(join(dir, 'databases', file));
    const id = str(raw.id)!;
    const sources = Array.isArray(raw.dataSources)
      ? (raw.dataSources as Record<string, unknown>[])
      : [];
    databases.push({
      id,
      url: str(raw.url) ?? `https://app.notion.com/p/${id}`,
      title: str(raw.title) ?? '',
      parentId: str(raw.parentId) ?? null,
      inline: typeof raw.inline === 'boolean' ? raw.inline : null,
      linkedView: raw.linkedView === true,
      dataSources: sources
        .filter((s) => s.schema && typeof s.schema === 'object')
        .map((s) => ({
          url: str(s.url) ?? '',
          name: str(s.name) ?? '',
          schema: s.schema as NotionDatabase['dataSources'][number]['schema'],
          rows: Array.isArray(s.rows) ? (s.rows as Record<string, unknown>[]) : [],
        })),
    });
  }
  const captured = existsSync(join(dir, 'snapshot.json'))
    ? str(read(join(dir, 'snapshot.json')).capturedAt)
    : undefined;
  return { capturedAt: captured ?? new Date().toISOString(), pages, databases };
}

/** True if something is listening on the companion's port. */
export function companionRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export interface NotionImportRun {
  report: ImportReport;
  backupFiles: string[];
  reportFile: string;
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

function writePrivate(path: string, text: string) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export async function runNotionImport(options: {
  dataDir: string;
  snapshotDir: string;
  planFile: string;
  dryRun: boolean;
  database?: string;
  workspaceDir?: string;
  now?: Date;
  /** Tests skip the port check. */
  checkRunning?: boolean;
}): Promise<NotionImportRun> {
  const config = loadConfig(options.dataDir);
  if ((options.checkRunning ?? true) && (await companionRunning(config.port))) {
    throw new Error(
      `The companion is running on port ${config.port}. Stop it first: the import needs the database to itself.`,
    );
  }
  const snapshot = loadSnapshot(options.snapshotDir);
  const plan = parsePlan(JSON.parse(readFileSync(options.planFile, 'utf8')));
  const now = options.now ?? new Date();
  const database = options.database ?? join(options.dataDir, 'lowtide.sqlite');
  const backups = join(options.dataDir, 'backups');
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  const backupFiles: string[] = [];
  const base = join(backups, `pre-notion-import-${stamp(now)}`);
  // The exact database as it is now, copied before anything (even a schema migration) runs.
  if (!options.dryRun && database !== ':memory:' && existsSync(database)) {
    const raw = new DatabaseSync(database, { readOnly: true });
    try {
      raw.prepare('VACUUM INTO ?').run(`${base}.sqlite`);
    } finally {
      raw.close();
    }
    chmodSync(`${base}.sqlite`, 0o600);
    backupFiles.push(`${base}.sqlite`);
  }
  const store = new SqliteStore(database);
  try {
    const repositories = createRepositories(store);
    if (!options.dryRun) {
      writePrivate(
        `${base}.json`,
        `${JSON.stringify(await repositories.backup.exportBackup(), null, 2)}\n`,
      );
      backupFiles.push(`${base}.json`);
    }

    const report = await importNotion(store, snapshot, plan, {
      now,
      newId: randomUUID,
      dryRun: options.dryRun,
    });

    const imports = join(options.dataDir, 'imports');
    mkdirSync(imports, { recursive: true, mode: 0o700 });
    const reportFile = join(
      imports,
      `notion-${options.dryRun ? 'dry-run-' : ''}${stamp(now)}.json`,
    );
    writePrivate(reportFile, `${JSON.stringify(report, null, 2)}\n`);

    if (!options.dryRun) {
      const sync = new WorkspaceSync(
        store,
        repositories,
        options.workspaceDir ?? config.workspaceDir,
        () => now,
      );
      await sync.sync();
    }
    return { report, backupFiles, reportFile };
  } finally {
    store.close();
  }
}

/** A short human summary of a report. */
export function summarise(run: NotionImportRun): string {
  const { report } = run;
  const lines = [
    report.dryRun ? 'DRY RUN: nothing was written.' : 'Import complete.',
    `Sources: ${report.sources.pages} pages, ${report.sources.rowPages} row pages, ${report.sources.databases} databases (${report.sources.rows} rows), ${report.sources.linkedViews} linked views.`,
  ];
  for (const [type, actions] of Object.entries(report.counts).sort()) {
    lines.push(
      `  ${type}: ${Object.entries(actions)
        .map(([a, n]) => `${n} ${a}`)
        .join(', ')}`,
    );
  }
  lines.push(
    `Skipped ${report.skipped.length}, SPACE-only ${report.spaceOnly.length}, conflicts ${report.conflicts.length}, failures ${report.failures.length}, attachments ${report.attachments.length}.`,
  );
  if (run.backupFiles.length) lines.push(`Backups: ${run.backupFiles.join(', ')}`);
  lines.push(`Report: ${run.reportFile}`);
  return lines.join('\n');
}
