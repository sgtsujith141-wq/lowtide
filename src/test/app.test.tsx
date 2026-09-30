import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { setupTestDatabase, expectFocus } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

describe('App shell', () => {
  it('boots to Home with landmarks and the v2 navigation (ADR-043)', async () => {
    await renderApp('/', createDexieRepositories(newDb()));
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const items = within(nav).getAllByRole('listitem');
    const names = (keep: (li: HTMLElement) => boolean) =>
      items.filter(keep).map((li) => li.textContent);
    // Phones: five tabs. Desktop: every destination, and no More.
    expect(names((li) => !li.classList.contains('max-md:hidden'))).toEqual([
      'Home',
      'Projects',
      'Hackathons',
      'Rhythm',
      'More',
    ]);
    expect(names((li) => !li.classList.contains('md:hidden'))).toEqual([
      'Home',
      'Projects',
      'Today',
      'Inbox',
      'Tasks',
      'Hackathons',
      'Rhythm',
      'Life',
      'Calendar',
      'AI',
      'Settings',
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    for (const name of ['Start Work', 'Sleep Mode', 'Ask LOWTIDE'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    await vi.waitFor(() => expect(document.title).toBe('Home · LOWTIDE')); // set in an effect
  });

  it('marks the current section and navigates between sections', async () => {
    const { user } = await renderApp('/', createDexieRepositories(newDb()));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    // Each click loads a screen chunk for the first time in this worker; like the
    // first render in renderApp, that import can take seconds on a loaded machine.
    await user.click(within(nav).getByRole('link', { name: 'Tasks' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tasks' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');

    await user.click(within(nav).getByRole('link', { name: 'Inbox' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Inbox' }, { timeout: 8000 }),
    ).toBeInTheDocument();
  });

  it('offers a skip link that moves focus to the main content', async () => {
    const { user } = await renderApp('/tasks', createDexieRepositories(newDb()));
    await user.click(screen.getByRole('link', { name: 'Skip to content' }));
    await expectFocus(() => screen.getByRole('main'));
  });

  it('shows a way home for unknown routes, inside the shell', async () => {
    await renderApp('/nowhere', createDexieRepositories(newDb()));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to LOWTIDE' })).toHaveAttribute('href', '/');
  });
});

describe('route-level code splitting', () => {
  it.each([
    ['/', 'Home'],
    ['/today', 'Today'],
    ['/projects', 'Projects'],
    ['/more', 'More'],
    ['/life', 'Life'],
    ['/calendar', 'Calendar'],
    ['/ai', 'AI & workspace'],
    ['/inbox', 'Inbox'],
    ['/tasks', 'Tasks'],
    ['/rhythm', 'Rhythm'],
    ['/hackathons', 'Hackathons'],
  ])('loads the lazy screen at %s', async (path, heading) => {
    await renderApp(path, createDexieRepositories(newDb()));
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('prefetches every screen chunk without rendering anything', async () => {
    const { prefetchScreens } = await import('../app/routes');
    // Awaited, so no import is still running when the test environment closes.
    await expect(prefetchScreens()).resolves.toBeUndefined();
  });
});
