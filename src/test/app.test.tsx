import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

describe('App shell', () => {
  it('boots to Today with landmarks, main navigation and capture ready', async () => {
    await renderApp('/', createDexieRepositories(newDb()));
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Today', 'Inbox', 'Tasks', 'Rhythm']);
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'What’s taking up space?' })).toHaveFocus();
    expect(document.title).toBe('Today · LOWTIDE');
  });

  it('marks the current section and navigates between sections', async () => {
    const { user } = await renderApp('/', createDexieRepositories(newDb()));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(within(nav).getByRole('link', { name: 'Tasks' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');

    await user.click(within(nav).getByRole('link', { name: 'Inbox' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
  });

  it('offers a skip link that moves focus to the main content', async () => {
    const { user } = await renderApp('/tasks', createDexieRepositories(newDb()));
    await user.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('shows a way home for unknown routes, inside the shell', async () => {
    await renderApp('/nowhere', createDexieRepositories(newDb()));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to LOWTIDE' })).toHaveAttribute('href', '/');
  });
});

describe('route-level code splitting', () => {
  it.each([
    ['/', 'Today'],
    ['/inbox', 'Inbox'],
    ['/tasks', 'Tasks'],
    ['/rhythm', 'Rhythm'],
  ])('loads the lazy screen at %s', async (path, heading) => {
    await renderApp(path, createDexieRepositories(newDb()));
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('prefetches every screen chunk without rendering anything', async () => {
    const { prefetchScreens } = await import('../app/routes');
    expect(() => prefetchScreens()).not.toThrow();
  });
});
