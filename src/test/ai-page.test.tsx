import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
afterEach(() => {
  vi.unstubAllGlobals();
});

async function seed(r: Repositories) {
  const p = await r.projects.create({ name: 'Engine', state: 'active', objective: 'Ship it' });
  await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off API' });
  await r.protectedTime.create({
    title: 'Date night PRIVATE',
    date: '2026-09-28',
    kind: 'relationship',
  });
  await r.inbox.capture('a private thought PRIVATE');
}

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

describe('AI & workspace page', () => {
  it('previews a project context pack by default, with no private data', async () => {
    const r = createDexieRepositories(newDb());
    await seed(r);
    await renderApp('/ai', r);
    const preview = await screen.findByLabelText('Context preview');
    expect(preview).toHaveTextContent('Scope: GLOBAL > PROJECT: Engine');
    expect(preview).toHaveTextContent('Ship it');
    expect(preview).toHaveTextContent('Sign off API');
    expect(preview).not.toHaveTextContent('PRIVATE');
  });

  it('shows private areas only when ticked in Global scope; protected time can’t be granted', async () => {
    const r = createDexieRepositories(newDb());
    await seed(r);
    const { user } = await renderApp('/ai', r);
    await screen.findByLabelText('Context preview');
    await user.click(screen.getByRole('radio', { name: /Global/ }));
    expect(screen.getByLabelText('Context preview')).not.toHaveTextContent('PRIVATE');
    await user.click(screen.getByRole('checkbox', { name: 'Inbox thoughts' }));
    expect(screen.getByLabelText('Context preview')).toHaveTextContent('a private thought PRIVATE');
    expect(screen.getByLabelText('Context preview')).not.toHaveTextContent('Date night');
    expect(screen.queryByRole('checkbox', { name: /protected/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Protected time can’t be granted/)).toBeInTheDocument();
  });

  it('exports the technical workspace as a zip, without private data', async () => {
    const r = createDexieRepositories(newDb());
    await seed(r);
    const { user } = await renderApp('/ai', r);
    // After rendering: the router itself needs the real URL constructor.
    const { blobs, names } = captureDownloads();
    await user.click(await screen.findByRole('button', { name: 'Export workspace (.zip)' }));
    await vi.waitFor(() => expect(names).toHaveLength(1));
    expect(names[0]).toMatch(/^lowtide-workspace-\d{4}-\d{2}-\d{2}\.zip$/);
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('projects/engine/CONTEXT.md');
    expect(text).toContain('Sign off API');
    expect(text).not.toContain('PRIVATE');
  });

  it('offers the project context in the Command Room’s AI tab', async () => {
    const r = createDexieRepositories(newDb());
    await seed(r);
    const { user } = await renderApp('/projects/engine', r);
    await user.click(await screen.findByRole('tab', { name: 'AI' }, { timeout: 5000 }));
    const panel = await screen.findByRole('region', { name: 'Context for AI clients' });
    expect(await within(panel).findByLabelText('Context preview')).toHaveTextContent(
      'PROJECT: Engine',
    );
  });
});
