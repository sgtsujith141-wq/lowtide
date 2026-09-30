// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import type { CompanionState } from '../src/app/companion-context';
import { routes } from '../src/app/routes';
import {
  CompanionClient,
  createCompanionRepositories,
  type CompanionConnection,
} from '../src/db/companion/client';
import { openDatabase } from '../src/db/database';
import { STORE_NAMES } from '../src/db/migrations';
import {
  createDexieRepositories,
  createRepositories,
  type Repositories,
} from '../src/db/repositories';
import { stable } from './server/migrate';
import { startCompanion } from './server/app';
import { deterministic, mcpClient, scenario, startTestCompanion } from './server/test-fixtures';

/*
 * The app against a real companion (HTTP, SQLite, SSE), in jsdom. jsdom's
 * AbortSignal isn't Node's, so the test client leaves signals out.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

const nodeFetch = (input: string, init: RequestInit = {}) => {
  const copy = { ...init };
  delete copy.signal;
  return fetch(input, copy);
};
const connect = (connection: CompanionConnection) => {
  const client = new CompanionClient(connection, nodeFetch);
  cleanups.push(() => client.stop());
  return client;
};

function renderAt(path: string, repositories: Repositories, companion: CompanionState) {
  const user = userEvent.setup();
  render(
    <App
      repositories={repositories}
      router={createMemoryRouter(routes, { initialEntries: [path] })}
      companion={companion}
    />,
  );
  return user;
}

function captureDownloads() {
  const names: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return names;
}

describe('the app with a real companion', () => {
  it('moves a real browser profile into the companion through Settings, verified', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'lowtide-ui-'));
    const companion = await startCompanion({ dataDir, port: 0, database: ':memory:' });
    cleanups.push(async () => {
      await companion.close();
      rmSync(dataDir, { recursive: true, force: true });
    });
    const db = openDatabase(`lowtide-ui-${crypto.randomUUID()}`);
    cleanups.push(() => db.delete());
    const browser = createDexieRepositories(db, deterministic());
    await scenario(browser);
    const before = await browser.backup.exportBackup();
    const downloads = captureDownloads();
    const switchTo = vi.fn();

    const user = renderAt('/settings', browser, {
      backend: { kind: 'browser' },
      client: null,
      connect,
      switchTo,
    });
    const address = await screen.findByLabelText('Companion address', undefined, { timeout: 5000 });
    await user.clear(address);
    await user.type(address, companion.url);
    await user.type(screen.getByLabelText('Owner token'), companion.config.ownerToken);
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText(/Paired with the companion/)).toBeInTheDocument();

    const move = screen.getByRole('button', { name: 'Move LOWTIDE into the companion' });
    expect(move).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Download a backup' }));
    expect(await screen.findByText(/Saved and checked/)).toBeInTheDocument();
    expect(downloads).toEqual([expect.stringMatching(/^lowtide-backup-.*\.json$/)]);
    expect(move).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: 'I have the backup file somewhere safe' }),
    );
    await user.click(move);

    const heading = await screen.findByRole(
      'heading',
      { name: 'Moved and verified' },
      { timeout: 5000 },
    );
    expect(heading).toHaveFocus();
    const checks = screen.getByRole('list', { name: 'Checks' });
    expect(within(checks).getAllByRole('listitem').length).toBeGreaterThanOrEqual(10);
    expect(within(checks).queryByText(/\(failed\)/)).toBeNull();
    expect(screen.getByRole('row', { name: /Protected time 1 1/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to the companion' }));
    expect(switchTo).toHaveBeenCalledWith({
      kind: 'companion',
      url: companion.url,
      token: companion.config.ownerToken,
    });

    // The companion holds exactly the browser's data; the browser's copy is untouched.
    const moved = await createRepositories(companion.store, {
      watch: companion.store.watch,
    }).backup.exportBackup();
    for (const name of STORE_NAMES)
      expect(stable(moved.data[name]), name).toBe(stable(before.data[name]));
    const after = await browser.backup.exportBackup();
    expect(stable(after.data)).toBe(stable(before.data));
  });

  it('shows an AI client’s changes live in the Project Room, attributed', async () => {
    const t = await startTestCompanion();
    cleanups.push(() => t.close());
    const client = connect({ url: t.companion.url, token: t.ownerToken });
    const user = renderAt('/projects/engine', createCompanionRepositories(client), {
      backend: { kind: 'companion', url: t.companion.url, token: t.ownerToken },
      client,
    });
    await screen.findByRole('heading', { level: 1, name: 'Engine' }, { timeout: 8000 });
    await user.click(screen.getByRole('tab', { name: 'Docs' }));
    let notes = await screen.findByRole('region', { name: 'Notes' }, { timeout: 5000 });
    expect(await within(notes).findByText('Queues')).toBeInTheDocument();

    const ai = await mcpClient(
      t.companion.url,
      await t.grant({ label: 'Claude Code', scope: 'project', access: 'write' }),
    );
    await ai.call('create_note', {
      title: 'Bridge handoff',
      body: 'Pair the app next.',
      kind: 'handoff',
    });
    await ai.call('record_decision', { title: 'Transport', decision: 'Streamable HTTP' });

    expect(
      await within(notes).findByText('Bridge handoff', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(notes).getByText(/Handoff · by Claude Code/)).toBeInTheDocument();
    expect(
      await screen.findByText(/recorded by Claude Code/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();

    // The timeline names the client, too.
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(
      (await screen.findAllByText('(by Claude Code)', undefined, { timeout: 5000 })).length,
    ).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole('tab', { name: 'Docs' }));
    notes = await screen.findByRole('region', { name: 'Notes' }, { timeout: 5000 });

    // And the owner's own note goes through the companion too.
    await user.type(within(notes).getByLabelText('Note title'), 'Mine');
    await user.type(within(notes).getByLabelText('Text (Markdown)'), 'Owner words.');
    await user.click(within(notes).getByRole('button', { name: 'Add note' }));
    expect(
      await within(notes).findByText('Mine', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    const stored = (await t.companion.store.notes.toArray()).find((n) => n.title === 'Mine');
    expect(stored).toMatchObject({ author: 'owner' });
  });

  it('gives, shows and revokes AI access, with a live audit of what the client did', async () => {
    const t = await startTestCompanion();
    cleanups.push(() => t.close());
    const client = connect({ url: t.companion.url, token: t.ownerToken });
    const user = renderAt('/ai', createCompanionRepositories(client), {
      backend: { kind: 'companion', url: t.companion.url, token: t.ownerToken },
      client,
    });
    const clients = await screen.findByRole('region', { name: 'AI clients' }, { timeout: 8000 });
    await vi.waitFor(() => expect(within(clients).getAllByText('Never connected')).toHaveLength(4));

    const form = screen.getByRole('form', { name: 'Give an AI client access' });
    await user.click(within(form).getByRole('radio', { name: 'Read and make changes' }));
    await user.click(within(form).getByRole('button', { name: 'Create access' }));
    const token = (await screen.findByRole(
      'textbox',
      { name: 'Token' },
      { timeout: 5000 },
    )) as HTMLInputElement;
    expect(token.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(screen.getByText(/claude mcp add lowtide/)).toHaveTextContent('lowtide-mcp.ts');

    const ai = await mcpClient(t.companion.url, token.value);
    await ai.call('create_note', { title: 'Hello from the client', body: 'x' });
    await vi.waitFor(() => expect(within(clients).getByText('Connected')).toBeInTheDocument(), {
      timeout: 5000,
    });
    const log = screen.getByRole('list', { name: 'AI activity' });
    expect(
      await within(log).findByText(/added a note/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(log).getByText(/“Hello from the client”/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done, I’ve saved it' }));
    await user.click(screen.getByRole('button', { name: 'Revoke Claude Code' }));
    expect(
      await screen.findByText('No AI client can use LOWTIDE right now.', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    const refused = await ai.post({ jsonrpc: '2.0', id: 99, method: 'ping' });
    expect(refused.status).toBe(401);
  });

  it('shows the companion in Settings and switches back only when asked', async () => {
    const t = await startTestCompanion();
    cleanups.push(() => t.close());
    const client = connect({ url: t.companion.url, token: t.ownerToken });
    const switchTo = vi.fn();
    const user = renderAt('/settings', createCompanionRepositories(client), {
      backend: { kind: 'companion', url: t.companion.url, token: t.ownerToken },
      client,
      switchTo,
    });
    expect(await screen.findByText('Connected', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText(':memory:')).toBeInTheDocument();
    const back = screen.getByRole('button', { name: 'Use this browser’s storage' });
    expect(back).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /don’t come back by themselves/ }));
    await user.click(back);
    expect(switchTo).toHaveBeenCalledWith({ kind: 'browser' });
  });
});
