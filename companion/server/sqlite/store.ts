import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { StoreName } from '../../../src/db/migrations';
import type {
  IndexValue,
  StoreCollection,
  StoreDb,
  StoreTable,
  StoreWhere,
  TransactionMode,
} from '../../../src/db/store';
import type { Watch } from '../../../src/db/repositories';
import { applyMigrations, pendingMigrations } from './migrations';
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { indexColumns, TABLES, type TableSpec } from './tables';

/*
 * The storage contract (ADR-057) on SQLite (node:sqlite, synchronous). One
 * connection, and every operation runs through a single queue:
 * - a transaction takes the queue for its whole scope (BEGIN … COMMIT, or
 *   ROLLBACK on any error, including a deferred foreign-key failure);
 * - operations inside a transaction's scope join it (AsyncLocalStorage);
 * - any other operation waits its turn, so it can never land inside someone
 *   else's open transaction.
 * After each commit, listeners hear which stores changed.
 */

type Row = Record<string, unknown>;
type Changes = ReadonlySet<StoreName>;

export class ConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConstraintError';
  }
}

function mapError(error: unknown): unknown {
  if (error instanceof Error && /constraint failed/i.test(error.message)) {
    return new ConstraintError(error.message);
  }
  return error;
}

interface TxState {
  changed: Set<StoreName>;
}

export class SqliteStore implements StoreDb {
  readonly sql: DatabaseSync;
  private readonly context = new AsyncLocalStorage<TxState>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly statements = new Map<string, StatementSync>();
  private readonly listeners = new Set<(changes: Changes) => void>();

  tasks!: SqliteTable<StoreDb['tasks'] extends StoreTable<infer T> ? T : never>;
  inbox!: SqliteTable<StoreDb['inbox'] extends StoreTable<infer T> ? T : never>;
  habits!: SqliteTable<StoreDb['habits'] extends StoreTable<infer T> ? T : never>;
  habitEntries!: SqliteTable<StoreDb['habitEntries'] extends StoreTable<infer T> ? T : never>;
  hackathons!: SqliteTable<StoreDb['hackathons'] extends StoreTable<infer T> ? T : never>;
  protectedTime!: SqliteTable<StoreDb['protectedTime'] extends StoreTable<infer T> ? T : never>;
  projects!: SqliteTable<StoreDb['projects'] extends StoreTable<infer T> ? T : never>;
  milestones!: SqliteTable<StoreDb['milestones'] extends StoreTable<infer T> ? T : never>;
  projectItems!: SqliteTable<StoreDb['projectItems'] extends StoreTable<infer T> ? T : never>;
  decisions!: SqliteTable<StoreDb['decisions'] extends StoreTable<infer T> ? T : never>;
  workSessions!: SqliteTable<StoreDb['workSessions'] extends StoreTable<infer T> ? T : never>;
  offTimeSessions!: SqliteTable<StoreDb['offTimeSessions'] extends StoreTable<infer T> ? T : never>;
  events!: SqliteTable<StoreDb['events'] extends StoreTable<infer T> ? T : never>;
  progressSnapshots!: SqliteTable<
    StoreDb['progressSnapshots'] extends StoreTable<infer T> ? T : never
  >;
  aiSessions!: SqliteTable<StoreDb['aiSessions'] extends StoreTable<infer T> ? T : never>;
  collegeItems!: SqliteTable<StoreDb['collegeItems'] extends StoreTable<infer T> ? T : never>;
  notes!: SqliteTable<StoreDb['notes'] extends StoreTable<infer T> ? T : never>;
  spaceNodes!: SqliteTable<StoreDb['spaceNodes'] extends StoreTable<infer T> ? T : never>;
  sourceRecords!: SqliteTable<StoreDb['sourceRecords'] extends StoreTable<infer T> ? T : never>;

  /** `path` is a file, or ':memory:' for tests. */
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA foreign_keys = ON');
    this.sql.exec('PRAGMA busy_timeout = 5000');
    if (path !== ':memory:') {
      this.sql.exec('PRAGMA journal_mode = WAL');
      backupBeforeUpgrade(this.sql, path);
    }
    applyMigrations(this.sql);
    for (const spec of TABLES) {
      (this as unknown as Record<string, unknown>)[spec.store] = new SqliteTable(this, spec);
    }
  }

  close() {
    this.sql.close();
  }

  /** Called after every committed change, with the stores it touched. */
  onChange(listener: (changes: Changes) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  prepare(text: string): StatementSync {
    let statement = this.statements.get(text);
    if (!statement) {
      statement = this.sql.prepare(text);
      this.statements.set(text, statement);
    }
    return statement;
  }

  private notify(changes: Changes) {
    for (const listener of [...this.listeners]) {
      try {
        listener(changes);
      } catch {
        // A listener's failure never affects storage.
      }
    }
  }

  private enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Runs one storage operation: inside the current transaction, or queued. */
  exec<T>(work: () => T, wrote?: StoreName): Promise<T> {
    const tx = this.context.getStore();
    if (tx) {
      try {
        const result = work();
        if (wrote) tx.changed.add(wrote);
        return Promise.resolve(result);
      } catch (error) {
        return Promise.reject(mapError(error));
      }
    }
    return this.enqueue(() => {
      try {
        const result = work();
        if (wrote) this.notify(new Set([wrote]));
        return result;
      } catch (error) {
        throw mapError(error);
      }
    });
  }

  transaction<R>(mode: TransactionMode, ...rest: unknown[]): Promise<R> {
    const scope = rest.at(-1) as () => Promise<R>;
    if (this.context.getStore()) return scope(); // join the open transaction
    return this.enqueue(async () => {
      const state: TxState = { changed: new Set() };
      this.sql.exec(mode === 'rw' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const result = await this.context.run(state, scope);
        this.sql.exec('COMMIT');
        if (state.changed.size) this.notify(state.changed);
        return result;
      } catch (error) {
        if (this.sql.isTransaction) this.sql.exec('ROLLBACK');
        throw mapError(error);
      }
    });
  }

  /**
   * Live queries on SQLite: run now, and again (once per burst of commits)
   * whenever anything changes. The server uses them for one-shot reads.
   */
  watch = <T>(query: () => Promise<T>): Watch<T> => {
    return (onChange, onError) => {
      let stopped = false;
      let pending = false;
      const run = () => {
        pending = false;
        query().then(
          (value) => !stopped && onChange(value),
          (error: unknown) => !stopped && onError?.(error),
        );
      };
      run();
      const off = this.onChange(() => {
        if (pending) return;
        pending = true;
        queueMicrotask(run);
      });
      return () => {
        stopped = true;
        off();
      };
    };
  };
}

/* Row ↔ record mapping. */

function toRow(spec: TableSpec, record: Record<string, unknown>): unknown[] {
  return spec.columns.map((c) => {
    const value = record[c.field];
    if (value === undefined || value === null) return null;
    switch (c.type) {
      case 'bool':
        return value ? 1 : 0;
      case 'json':
        return JSON.stringify(value);
      default:
        return value;
    }
  });
}

function toRecord<T>(spec: TableSpec, row: Row): T {
  const record: Record<string, unknown> = {};
  for (const c of spec.columns) {
    const value = row[c.column];
    if (value === null || value === undefined) continue;
    record[c.field] =
      c.type === 'bool' ? value === 1 : c.type === 'json' ? JSON.parse(value as string) : value;
  }
  return record as T;
}

interface Query {
  where: string;
  params: unknown[];
  order: string;
}

export class SqliteTable<T> implements StoreTable<T> {
  private readonly columns: string;
  private readonly placeholders: string;
  private readonly updates: string;

  constructor(
    private readonly store: SqliteStore,
    readonly spec: TableSpec,
  ) {
    this.columns = spec.columns.map((c) => c.column).join(', ');
    this.placeholders = spec.columns.map(() => '?').join(', ');
    this.updates = spec.columns
      .filter((c) => c.field !== 'id')
      .map((c) => `${c.column} = excluded.${c.column}`)
      .join(', ');
  }

  get name(): StoreName {
    return this.spec.store;
  }

  select(query: Query, limit?: number): T[] {
    const text = `SELECT * FROM ${this.spec.table}${query.where ? ` WHERE ${query.where}` : ''} ORDER BY ${query.order}${limit ? ` LIMIT ${limit}` : ''}`;
    const rows = this.store.prepare(text).all(...(query.params as never[])) as Row[];
    return rows.map((row) => toRecord<T>(this.spec, row));
  }

  get(key: string): Promise<T | undefined> {
    return this.store.exec(() => {
      const row = this.store.prepare(`SELECT * FROM ${this.spec.table} WHERE id = ?`).get(key) as
        Row | undefined;
      return row ? toRecord<T>(this.spec, row) : undefined;
    });
  }

  put(record: T): Promise<unknown> {
    return this.store.exec(() => {
      this.store
        .prepare(
          `INSERT INTO ${this.spec.table} (${this.columns}) VALUES (${this.placeholders}) ON CONFLICT(id) DO UPDATE SET ${this.updates}`,
        )
        .run(...(toRow(this.spec, record as Record<string, unknown>) as never[]));
      return (record as { id: string }).id;
    }, this.spec.store);
  }

  add(record: T): Promise<unknown> {
    return this.store.exec(() => {
      this.store
        .prepare(`INSERT INTO ${this.spec.table} (${this.columns}) VALUES (${this.placeholders})`)
        .run(...(toRow(this.spec, record as Record<string, unknown>) as never[]));
      return (record as { id: string }).id;
    }, this.spec.store);
  }

  bulkAdd(records: readonly T[]): Promise<unknown> {
    return this.store.exec(() => {
      const statement = this.store.prepare(
        `INSERT INTO ${this.spec.table} (${this.columns}) VALUES (${this.placeholders})`,
      );
      for (const record of records) {
        statement.run(...(toRow(this.spec, record as Record<string, unknown>) as never[]));
      }
      return records.length;
    }, this.spec.store);
  }

  delete(key: string): Promise<void> {
    return this.store.exec(() => {
      this.store.prepare(`DELETE FROM ${this.spec.table} WHERE id = ?`).run(key);
    }, this.spec.store);
  }

  clear(): Promise<void> {
    return this.store.exec(() => {
      this.store.prepare(`DELETE FROM ${this.spec.table}`).run();
    }, this.spec.store);
  }

  count(): Promise<number> {
    return this.store.exec(
      () =>
        (this.store.prepare(`SELECT COUNT(*) AS n FROM ${this.spec.table}`).get() as { n: number })
          .n,
    );
  }

  toArray(): Promise<T[]> {
    return this.toCollection().toArray();
  }

  toCollection(): StoreCollection<T> {
    return new SqliteCollection(this.store, this, { where: '', params: [], order: 'id' });
  }

  filter(fn: (record: T) => boolean): StoreCollection<T> {
    return this.toCollection().filter(fn);
  }

  orderBy(index: string): StoreCollection<T> {
    const cols = indexColumns(this.spec, index);
    return new SqliteCollection(this.store, this, {
      where: cols.map((c) => `${c} IS NOT NULL`).join(' AND '),
      params: [],
      order: [...cols, 'id'].join(', '),
    });
  }

  where(index: string): StoreWhere<T> {
    const cols = indexColumns(this.spec, index);
    const order = [...cols, 'id'].join(', ');
    const make = (where: string, params: unknown[]) =>
      new SqliteCollection(this.store, this, { where, params, order });
    const values = (value: IndexValue) =>
      (Array.isArray(value) ? value : [value]) as readonly (string | number)[];
    return {
      equals: (value) => {
        const v = values(value);
        return make(cols.map((c) => `${c} = ?`).join(' AND '), [...v]);
      },
      between: (lower, upper, includeLower = true, includeUpper = false) => {
        if (cols.length !== 1) throw new Error('between() is for single-field indexes');
        const c = cols[0]!;
        return make(`${c} ${includeLower ? '>=' : '>'} ? AND ${c} ${includeUpper ? '<=' : '<'} ?`, [
          lower,
          upper,
        ]);
      },
      belowOrEqual: (value) => {
        if (cols.length !== 1) throw new Error('belowOrEqual() is for single-field indexes');
        return make(`${cols[0]} <= ?`, [value]);
      },
    };
  }
}

class SqliteCollection<T> implements StoreCollection<T> {
  constructor(
    private readonly store: SqliteStore,
    private readonly table: SqliteTable<T>,
    private readonly query: Query,
    private readonly filters: ((record: T) => boolean)[] = [],
  ) {}

  private matches(): T[] {
    const records = this.table.select(this.query);
    return this.filters.length ? records.filter((r) => this.filters.every((f) => f(r))) : records;
  }

  filter(fn: (record: T) => boolean): StoreCollection<T> {
    return new SqliteCollection(this.store, this.table, this.query, [...this.filters, fn]);
  }

  toArray(): Promise<T[]> {
    return this.store.exec(() => this.matches());
  }

  first(): Promise<T | undefined> {
    return this.store.exec(() =>
      this.filters.length ? this.matches()[0] : this.table.select(this.query, 1)[0],
    );
  }

  count(): Promise<number> {
    return this.store.exec(() => this.matches().length);
  }

  delete(): Promise<number> {
    return this.store.exec(() => {
      const ids = this.matches().map((r) => (r as { id: string }).id);
      const statement = this.store.prepare(`DELETE FROM ${this.table.spec.table} WHERE id = ?`);
      for (const id of ids) statement.run(id);
      return ids.length;
    }, this.table.spec.store);
  }

  sortBy(key: string): Promise<T[]> {
    return this.store.exec(() =>
      this.matches().sort((a, b) => {
        const x = (a as Record<string, unknown>)[key] as string | number;
        const y = (b as Record<string, unknown>)[key] as string | number;
        return x < y ? -1 : x > y ? 1 : 0;
      }),
    );
  }
}

/**
 * Before a schema upgrade touches a database that already holds data, a
 * full copy goes to checkpoints/ (v2.1), so the upgrade can be rolled back.
 */
function backupBeforeUpgrade(sql: DatabaseSync, path: string) {
  const pending = pendingMigrations(sql);
  const hasData = (
    sql
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
      .get() as {
      n: number;
    }
  ).n;
  if (!pending.length || !hasData) return;
  const dir = join(dirname(path), 'checkpoints');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = new Date();
  const id = `${at.toISOString().replace(/[:.]/g, '-')}-before-upgrade-${pending.at(-1)!}`;
  const file = join(dir, `${id}.sqlite`);
  sql.prepare('VACUUM INTO ?').run(file);
  chmodSync(file, 0o600);
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify(
      {
        id,
        name: `Before upgrading the database (migrations ${pending.join(', ')})`,
        at: at.toISOString(),
        by: 'LOWTIDE',
        bytes: statSync(file).size,
        auto: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
