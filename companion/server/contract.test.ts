// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { CompanionClient, createCompanionRepositories } from '../../src/db/companion/client';
import { REPOSITORY_CONTRACT } from '../../src/db/companion/contract';
import { createRepositories } from '../../src/db/repositories';
import { once } from './rpc';
import { SqliteStore } from './sqlite/store';

const stores: SqliteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('the repository wire contract (ADR-058)', () => {
  it('lists exactly the members the real repositories have', () => {
    const store = new SqliteStore(':memory:');
    stores.push(store);
    const real = createRepositories(store, { watch: store.watch }) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(REPOSITORY_CONTRACT).sort()).toEqual(Object.keys(real).sort());
    for (const [repo, members] of Object.entries(REPOSITORY_CONTRACT)) {
      expect(Object.keys(members).sort(), repo).toEqual(Object.keys(real[repo]!).sort());
      for (const member of Object.keys(members)) {
        expect(typeof real[repo]![member], `${repo}.${member}`).toBe('function');
      }
    }
  });

  it('marks live members correctly: a watch answers once and stops', async () => {
    const store = new SqliteStore(':memory:');
    stores.push(store);
    const real = createRepositories(store, { watch: store.watch });
    await real.projects.create({ name: 'Engine' });
    expect((await once(real.projects.watchAll)).map((p) => p.name)).toEqual(['Engine']);
    expect(await once(real.backup.watchCounts)).toMatchObject({ projects: 1 });
    expect(await once(real.projects.watchBySlug('engine'))).toMatchObject({ name: 'Engine' });
  });

  it('gives the app a companion repository for every member', () => {
    const client = new CompanionClient({ url: 'http://127.0.0.1:1', token: 'x'.repeat(43) });
    const remote = createCompanionRepositories(client) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const [repo, members] of Object.entries(REPOSITORY_CONTRACT)) {
      for (const member of Object.keys(members)) {
        expect(typeof remote[repo]?.[member], `${repo}.${member}`).toBe('function');
      }
    }
    // Pure members run in the app itself.
    expect(remote.backup!.inspect).toBeTypeOf('function');
    expect((remote.backup!.inspect as (t: string) => { ok: boolean })('nope').ok).toBe(false);
  });
});
