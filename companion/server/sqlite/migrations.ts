import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '../../../src/db/schema';
import { PROJECT_FOCUS } from '../../../src/types/domain';
import { columnDdl, domainDdl, TABLE_BY_STORE, V6_TABLES, V7_TABLES } from './tables';
import type { StoreName } from '../../../src/db/migrations';

/*
 * Companion database migrations (ADR-057). Each runs once, in order, inside
 * one transaction, and is recorded in `companion_migrations`. The LOWTIDE
 * domain schema version the tables represent is kept in `companion_meta`.
 * Append new migrations; never edit a shipped one.
 */

interface Migration {
  id: number;
  name: string;
  statements: () => string[];
  /** For changes that depend on the database's current shape (run after `statements`). */
  apply?: (sql: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'domain schema V6 tables',
    statements: () => domainDdl(V6_TABLES),
  },
  {
    id: 2,
    name: 'companion: AI grants, audit log, client sightings, settings',
    statements: () => [
      `CREATE TABLE ai_grants (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        client_kind TEXT NOT NULL CHECK (client_kind IN ('claude-code', 'claude', 'chatgpt', 'other')),
        scope TEXT NOT NULL CHECK (scope IN ('project', 'workspace', 'global')),
        project_id TEXT,
        access TEXT NOT NULL CHECK (access IN ('read', 'write')),
        allow_resolve_approvals INTEGER NOT NULL CHECK (allow_resolve_approvals IN (0, 1)),
        sensitive TEXT NOT NULL CHECK (json_valid(sensitive)),
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        CHECK (scope != 'project' OR project_id IS NOT NULL)
      ) STRICT`,
      `CREATE TABLE ai_audit (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        client TEXT NOT NULL,
        client_kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        session_id TEXT,
        request_id TEXT,
        operation TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        before_summary TEXT,
        after_summary TEXT,
        result TEXT NOT NULL CHECK (result IN ('ok', 'refused', 'error')),
        message TEXT
      ) STRICT`,
      'CREATE INDEX ai_audit_at ON ai_audit (at)',
      `CREATE TABLE ai_sightings (
        grant_id TEXT PRIMARY KEY,
        client_name TEXT,
        client_version TEXT,
        session_id TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    id: 3,
    name: 'domain schema V7: SPACE nodes and source records',
    statements: () => domainDdl(V7_TABLES),
  },
  {
    id: 4,
    name: 'domain schema V8: optional project focus',
    statements: () => [],
    // Databases created after V8 already have the column (migration 1 builds
    // tables from the current definitions); older ones gain it here.
    apply: (sql) => {
      const columns = sql.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
      if (columns.some((c) => c.name === 'focus')) return;
      sql.exec(
        `ALTER TABLE projects ADD COLUMN focus TEXT CHECK (focus IN (${PROJECT_FOCUS.map((f) => `'${f}'`).join(', ')}))`,
      );
    },
  },
  {
    id: 5,
    name: 'domain schema V9: SPACE blocks, revision and edits',
    statements: () => [],
    // Additive, like migration 4: new databases already have the columns.
    apply: (sql) => {
      const columns = new Set(
        (sql.prepare('PRAGMA table_info(space_nodes)').all() as { name: string }[]).map(
          (c) => c.name,
        ),
      );
      if (!columns.has('blocks'))
        sql.exec(
          'ALTER TABLE space_nodes ADD COLUMN blocks TEXT CHECK (blocks IS NULL OR json_valid(blocks))',
        );
      if (!columns.has('revision')) {
        sql.exec('ALTER TABLE space_nodes ADD COLUMN revision INTEGER');
      }
      if (!columns.has('edits')) {
        sql.exec(
          'ALTER TABLE space_nodes ADD COLUMN edits TEXT CHECK (edits IS NULL OR json_valid(edits))',
        );
      }
    },
  },
  {
    id: 6,
    name: 'domain schema V10 (v2.1): subtasks, archive, pins, descriptions',
    statements: () => [],
    // Additive and idempotent: nullable columns only, so a companion that
    // doesn't know them keeps working (its upserts name only its own columns).
    apply: (sql) => {
      addMissingColumns(sql, 'tasks', ['parentId']);
      addMissingColumns(sql, 'hackathons', ['archivedAt', 'pinnedAt']);
      addMissingColumns(sql, 'projects', ['description', 'pinnedAt']);
      addMissingColumns(sql, 'milestones', ['archivedAt']);
      addMissingColumns(sql, 'spaceNodes', ['description', 'pinnedAt']);
      sql.exec('CREATE INDEX IF NOT EXISTS tasks_parent_id ON tasks (parent_id)');
    },
  },
  {
    id: 7,
    name: 'companion (v2.1): grant capabilities and presets, AI change log',
    statements: () => [],
    // Additive: an older companion reads grants by name and ignores the new
    // columns, and never touches the new table.
    apply: (sql) => {
      const columns = new Set(
        (sql.prepare('PRAGMA table_info(ai_grants)').all() as { name: string }[]).map(
          (c) => c.name,
        ),
      );
      if (!columns.has('capabilities'))
        sql.exec(
          'ALTER TABLE ai_grants ADD COLUMN capabilities TEXT CHECK (capabilities IS NULL OR json_valid(capabilities))',
        );
      if (!columns.has('preset')) sql.exec('ALTER TABLE ai_grants ADD COLUMN preset TEXT');
      sql.exec(`CREATE TABLE IF NOT EXISTS ai_changes (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        client TEXT NOT NULL,
        tool TEXT NOT NULL,
        summary TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        batch_id TEXT,
        inverse TEXT CHECK (inverse IS NULL OR json_valid(inverse)),
        guard TEXT CHECK (guard IS NULL OR json_valid(guard)),
        reverted_at TEXT
      ) STRICT`);
      sql.exec('CREATE INDEX IF NOT EXISTS ai_changes_at ON ai_changes (at)');
    },
  },
  {
    id: 8,
    name: 'domain schema V11 (v2.2): hackathon kind and selection',
    statements: () => [],
    // Additive and idempotent, like migration 6: two nullable columns, each
    // with its own CHECK, so an older companion keeps working beside them.
    apply: (sql) => addMissingColumns(sql, 'hackathons', ['kind', 'selection']),
  },
];

/** ALTER TABLE … ADD COLUMN for each field the table doesn't have yet (from its current spec). */
export function addMissingColumns(sql: DatabaseSync, store: StoreName, fields: string[]) {
  const spec = TABLE_BY_STORE.get(store);
  if (!spec) throw new Error(`No table for ${store}`);
  const existing = new Set(
    (sql.prepare(`PRAGMA table_info(${spec.table})`).all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  for (const field of fields) {
    const column = spec.columns.find((c) => c.field === field);
    if (!column) throw new Error(`${store} has no field ${field}`);
    if (column.required) throw new Error(`Only optional columns can be added (${field})`);
    if (existing.has(column.column)) continue;
    sql.exec(`ALTER TABLE ${spec.table} ADD COLUMN ${columnDdl(column)}`);
  }
}

/** Migrations this database hasn't had yet (an empty list for a new database file). */
export function pendingMigrations(sql: DatabaseSync): number[] {
  const known = (
    sql
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'companion_migrations'",
      )
      .get() as { n: number }
  ).n;
  if (!known) return [];
  const applied = new Set(
    (sql.prepare('SELECT id FROM companion_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  return MIGRATIONS.filter((m) => !applied.has(m.id)).map((m) => m.id);
}

export function applyMigrations(sql: DatabaseSync) {
  sql.exec(`CREATE TABLE IF NOT EXISTS companion_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  sql.exec(`CREATE TABLE IF NOT EXISTS companion_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`);
  const applied = new Set(
    (sql.prepare('SELECT id FROM companion_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    sql.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements()) sql.exec(statement);
      migration.apply?.(sql);
      sql
        .prepare('INSERT INTO companion_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
      sql.exec('COMMIT');
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  }
  setMeta(sql, 'lowtide_schema_version', String(SCHEMA_VERSION));
}

export function getMeta(sql: DatabaseSync, key: string): string | undefined {
  const row = sql.prepare('SELECT value FROM companion_meta WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

export function setMeta(sql: DatabaseSync, key: string, value: string) {
  sql
    .prepare(
      'INSERT INTO companion_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}
