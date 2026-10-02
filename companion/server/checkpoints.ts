import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createRepositories } from '../../src/db/repositories';
import type { Checkpoint } from '../../src/db/companion/wire';
import { SqliteStore } from './sqlite/store';

/*
 * Checkpoints (v2.1): a named, consistent copy of the whole database
 * (SQLite's VACUUM INTO), taken before a schema upgrade, a restore, or a large
 * AI change, so it can be put back. Kept as owner-only files beside the
 * database; never on a schedule, never per write. Automatic ones are pruned
 * to the newest AUTO_KEEP; named ones the owner keeps until removed.
 */

const AUTO_KEEP = 20;
const ID = /^[0-9TZ-]+-[a-z0-9-]{1,60}$/;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'checkpoint';

interface Meta extends Checkpoint {
  auto: boolean;
}

export class Checkpoints {
  readonly dir: string;

  constructor(
    private readonly store: SqliteStore,
    dataDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dir = join(dataDir, 'checkpoints');
  }

  /** Copies the database now, between transactions. */
  async create(name: string, by: string, auto = false): Promise<Checkpoint> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const at = this.now();
    const id = `${at.toISOString().replace(/[:.]/g, '-')}-${slug(name)}`;
    const file = join(this.dir, `${id}.sqlite`);
    // Queued like any write, so it never lands inside an open transaction.
    await this.store.exec(() => {
      this.store.sql.prepare('VACUUM INTO ?').run(file);
    });
    chmodSync(file, 0o600);
    const meta: Meta = {
      id,
      name: name.slice(0, 200),
      at: at.toISOString(),
      by: by.slice(0, 200),
      bytes: statSync(file).size,
      auto,
    };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(meta, null, 2), { mode: 0o600 });
    if (auto) this.prune();
    return this.public(meta);
  }

  private public(m: Meta): Checkpoint {
    return { id: m.id, name: m.name, at: m.at, by: m.by, bytes: m.bytes };
  }

  private metas(): Meta[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        try {
          const meta = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Meta;
          return existsSync(join(this.dir, `${meta.id}.sqlite`)) ? [meta] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Newest first. */
  list(): Checkpoint[] {
    return this.metas().map((m) => this.public(m));
  }

  private file(id: string): string {
    if (!ID.test(id)) throw new Error('No such checkpoint');
    const file = join(this.dir, `${id}.sqlite`);
    if (!existsSync(file)) throw new Error('No such checkpoint');
    return file;
  }

  remove(id: string) {
    const file = this.file(id);
    rmSync(file, { force: true });
    rmSync(join(this.dir, `${id}.json`), { force: true });
  }

  private prune() {
    const auto = this.metas().filter((m) => m.auto);
    for (const m of auto.slice(AUTO_KEEP)) this.remove(m.id);
  }

  /**
   * The checkpoint's data as a backup document's text, read from a copy so
   * the checkpoint itself is never changed. Restoring goes through the
   * normal, validated backup restore.
   */
  async readAsBackup(id: string): Promise<string> {
    const source = this.file(id);
    const scratch = join(this.dir, `.read-${process.pid}-${Date.now()}.sqlite`);
    writeFileSync(scratch, readFileSync(source), { mode: 0o600 });
    const copy = new SqliteStore(scratch);
    try {
      return JSON.stringify(await createRepositories(copy).backup.exportBackup());
    } finally {
      copy.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${scratch}${suffix}`, { force: true });
    }
  }
}
