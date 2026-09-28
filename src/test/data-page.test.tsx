import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function seed(r: Repositories) {
  await r.tasks.create({ title: 'Essay' });
  await r.tasks.create({ title: 'Laundry' });
  const gym = await r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
  await r.habits.setEntry(gym.id, '2026-09-27', 1);
  await r.hackathons.create({ name: 'Hackurity', eventStart: '2026-10-04' });
  await r.protectedTime.create({ title: 'Call home', date: '2026-09-28', kind: 'family' });
}

async function setup(
  prepare?: (r: Repositories) => Promise<unknown>,
  override?: (r: Repositories) => Repositories,
) {
  const db = newDb();
  const base = createDexieRepositories(db);
  await prepare?.(base);
  const repositories = override ? override(base) : base;
  return { db, base, ...(await renderApp('/data', repositories)) };
}

/** Captures what the page downloads (jsdom has no object URLs). */
function captureDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.stubGlobal(
    'URL',
    Object.assign(Object.create(URL), URL, {
      createObjectURL: (b: Blob) => {
        blobs.push(b);
        return 'blob:lowtide-test';
      },
      revokeObjectURL: () => {},
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { blobs, names };
}

const fileInput = () => screen.getByLabelText('Choose a LOWTIDE backup file');
const file = (text: string, name = 'lowtide-backup.json') =>
  new File([text], name, { type: 'application/json' });

function setStorage(storage: object | undefined) {
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setStorage(undefined);
});

describe('Data & backup page', () => {
  it('is a lazy route reachable from the shell without a sixth tab', async () => {
    const { user } = await renderApp('/', createDexieRepositories(newDb()));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    const links = screen.getAllByRole('link', { name: 'Data & backup' });
    expect(links.length).toBeGreaterThanOrEqual(1);
    await user.click(links[0]!);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Data & backup' }),
    ).toBeInTheDocument();
  });

  it('warns that backups are not encrypted', async () => {
    await setup();
    expect(screen.getByText('Backup files are not encrypted.')).toBeInTheDocument();
  });

  it('downloads a complete backup as a dated JSON file', async () => {
    const { user } = await setup(seed);
    const { blobs, names } = captureDownloads();
    await user.click(screen.getByRole('button', { name: 'Download backup' }));

    expect(await screen.findByText(/^Downloaded lowtide-backup-/)).toBeInTheDocument();
    expect(names[0]).toMatch(/^lowtide-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const doc = JSON.parse(await blobs[0]!.text());
    expect(doc).toMatchObject({ format: 'lowtide-backup', formatVersion: 1, schemaVersion: 3 });
    expect(doc.data.tasks).toHaveLength(2);
    expect(Object.keys(doc.data)).toHaveLength(6);
  });

  it.each([
    ['not JSON', 'hello', 'That doesn’t look like a LOWTIDE backup.'],
    ['someone else’s JSON', '{"format":"other"}', 'That doesn’t look like a LOWTIDE backup.'],
    [
      'a newer format',
      JSON.stringify({
        format: 'lowtide-backup',
        formatVersion: 99,
        schemaVersion: 3,
        exportedAt: '2026-09-28T10:00:00.000Z',
        data: {},
      }),
      'This backup was created by a newer LOWTIDE version.',
    ],
    [
      'invalid data',
      JSON.stringify({
        format: 'lowtide-backup',
        formatVersion: 1,
        schemaVersion: 3,
        exportedAt: '2026-09-28T10:00:00.000Z',
        data: {
          tasks: [{ id: 'nope' }],
          inbox: [],
          habits: [],
          habitEntries: [],
          hackathons: [],
          protectedTime: [],
        },
      }),
      'That backup contains invalid data. Nothing was changed.',
    ],
  ])('rejects %s calmly, with no restore button and no changes', async (_, text, message) => {
    const { user, db } = await setup(seed);
    await user.upload(fileInput(), file(text));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(fileInput()).toHaveAccessibleDescription(message);
    expect(screen.queryByRole('button', { name: 'Restore backup' })).not.toBeInTheDocument();
    expect(await db.tasks.count()).toBe(2);
  });

  it('previews, requires confirmation, then replaces everything', async () => {
    // A backup made elsewhere with different data.
    const other = createDexieRepositories(newDb());
    await other.tasks.create({ title: 'From the backup' });
    await other.inbox.capture('backed-up thought');
    const backupText = JSON.stringify(await other.backup.exportBackup());

    const { user, db } = await setup(seed);
    await user.upload(fileInput(), file(backupText, 'my-backup.json'));

    const heading = await screen.findByRole('heading', { level: 3, name: /^Backup from / });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/my-backup\.json · Database version 3/)).toBeInTheDocument();
    const table = screen.getByRole('table', {
      name: 'Records in the backup and in this browser now',
    });
    const tasksRow = within(table).getByRole('row', { name: /Tasks/ });
    expect(
      within(tasksRow)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['1', '2']);
    expect(
      screen.getByText(
        'Importing this backup will replace the LOWTIDE data currently stored in this browser.',
      ),
    ).toBeInTheDocument();

    // Nothing has changed yet, and restore needs the confirmation.
    const restore = screen.getByRole('button', { name: 'Restore backup' });
    expect(restore).toBeDisabled();
    expect(await db.tasks.count()).toBe(2);
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I understand this replaces the LOWTIDE data in this browser.',
      }),
    );
    expect(restore).toBeEnabled();
    await user.click(restore);

    const status = await screen.findByText(/^Backup restored\./);
    expect(status).toHaveFocus();
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(['From the backup']);
    expect(await db.habits.count()).toBe(0);
    expect(await db.hackathons.count()).toBe(0);
    expect(await db.protectedTime.count()).toBe(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps current data and says so when the restore fails', async () => {
    const other = createDexieRepositories(newDb());
    await other.tasks.create({ title: 'From the backup' });
    const backupText = JSON.stringify(await other.backup.exportBackup());
    const { user, db } = await setup(seed, (r) => ({
      ...r,
      backup: { ...r.backup, restore: vi.fn().mockRejectedValue(new Error('QuotaExceededError')) },
    }));
    await user.upload(fileInput(), file(backupText));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Restore failed. Your existing LOWTIDE data is unchanged.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Quota');
    expect(await db.tasks.count()).toBe(2);
  });

  it('works by keyboard: cancel returns focus to the file input', async () => {
    const other = createDexieRepositories(newDb());
    const backupText = JSON.stringify(await other.backup.exportBackup());
    const { user } = await setup();
    await user.upload(fileInput(), file(backupText));
    await screen.findByRole('heading', { level: 3 });
    await user.tab();
    expect(screen.getByRole('checkbox')).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(fileInput()).toHaveFocus());
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });
});

describe('Browser storage status', () => {
  it('reports persistent storage without offering a request', async () => {
    setStorage({ persisted: async () => true, persist: vi.fn() });
    await setup();
    expect(await screen.findByText('Browser storage is marked persistent.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask browser/ })).not.toBeInTheDocument();
  });

  it('asks only when the button is pressed, and reports a grant', async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => false, persist });
    const { user } = await setup();
    await screen.findByText(/isn’t marked persistent/);
    expect(persist).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Ask browser to keep LOWTIDE data' }));
    expect(await screen.findByText('Browser granted persistent storage.')).toBeInTheDocument();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal honestly', async () => {
    setStorage({ persisted: async () => false, persist: async () => false });
    const { user } = await setup();
    await user.click(
      await screen.findByRole('button', { name: 'Ask browser to keep LOWTIDE data' }),
    );
    expect(
      await screen.findByText(
        'Browser didn’t grant persistent storage. Keep backup files somewhere safe.',
      ),
    ).toBeInTheDocument();
  });

  it('says when the browser has no controls', async () => {
    setStorage(undefined);
    await setup();
    expect(
      await screen.findByText('This browser doesn’t expose persistent-storage controls.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/doesn’t survive clearing site data/)).toBeInTheDocument();
  });
});
