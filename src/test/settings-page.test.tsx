import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKEND_KEY,
  companionUrl,
  pairingFromHash,
  readBackend,
  saveBackend,
} from '../db/companion/backend';
import { CompanionUnavailableError, type CompanionClient } from '../db/companion/client';
import { createDexieRepositories } from '../db/repositories';
import { readTheme, THEME_KEY } from '../lib/theme';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute('data-theme');
});
afterEach(() => {
  localStorage.clear();
  html().removeAttribute('data-theme');
});

describe('appearance (ADR-061)', () => {
  it('defaults to Auto and applies a forced Light or Dark theme at once', async () => {
    const { user } = await renderApp('/settings', createDexieRepositories(newDb()));
    const theme = screen.getByRole('group', { name: 'Theme' });
    expect(within(theme).getByRole('radio', { name: /Auto/ })).toBeChecked();
    expect(html()).not.toHaveAttribute('data-theme');

    await user.click(within(theme).getByRole('radio', { name: /Dark/ }));
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    await user.click(within(theme).getByRole('radio', { name: /Light/ }));
    expect(html()).toHaveAttribute('data-theme', 'light');

    await user.click(within(theme).getByRole('radio', { name: /Auto/ }));
    expect(html()).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('lets Sleep Mode dim the chosen theme without changing it', async () => {
    const { user } = await renderApp('/settings', createDexieRepositories(newDb()));
    await user.click(screen.getByRole('radio', { name: /Dark/ }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Sleep Mode' }, { timeout: 5000 }));
    await screen.findByRole('dialog', { name: 'Off time' }, { timeout: 8000 });
    expect(document.querySelector('[data-mode="sleep"]')).not.toBeNull();
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(readTheme()).toBe('dark');
  });

  it('reads only valid stored themes', () => {
    const storage = (value: string | null) => ({ getItem: () => value });
    expect(readTheme(storage('dark'))).toBe('dark');
    expect(readTheme(storage('light'))).toBe('light');
    expect(readTheme(storage('purple'))).toBe('auto');
    expect(readTheme(storage(null))).toBe('auto');
    expect(
      readTheme({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('auto');
  });
});

describe('the storage backend setting (ADR-058)', () => {
  it('only ever points at a companion on this computer', () => {
    expect(companionUrl('http://127.0.0.1:4318')).toBe('http://127.0.0.1:4318');
    expect(companionUrl('http://localhost:4318/')).toBe('http://localhost:4318');
    for (const bad of [
      'https://127.0.0.1:4318',
      'http://192.168.1.2:4318',
      'http://example.com:4318',
      'http://127.0.0.1',
      'http://127.0.0.1:4318/api',
      'javascript:alert(1)',
      '',
    ]) {
      expect(companionUrl(bad), bad).toBeUndefined();
    }
  });

  it('falls back to browser storage for anything unreadable, and remembers a pairing', () => {
    const token = 'a'.repeat(43);
    expect(readBackend()).toEqual({ kind: 'browser' });
    localStorage.setItem(BACKEND_KEY, '{nope');
    expect(readBackend()).toEqual({ kind: 'browser' });
    localStorage.setItem(
      BACKEND_KEY,
      JSON.stringify({ kind: 'companion', url: 'http://evil.example:80', token }),
    );
    expect(readBackend()).toEqual({ kind: 'browser' });
    saveBackend({ kind: 'companion', url: 'http://127.0.0.1:4318', token });
    expect(readBackend()).toEqual({ kind: 'companion', url: 'http://127.0.0.1:4318', token });
    saveBackend({ kind: 'browser' });
    expect(localStorage.getItem(BACKEND_KEY)).toBeNull();
  });

  it('reads a pairing link and ignores a malformed one', () => {
    const token = 'b'.repeat(43);
    expect(
      pairingFromHash(`#companion=${encodeURIComponent('http://127.0.0.1:4318')}&token=${token}`),
    ).toEqual({ url: 'http://127.0.0.1:4318', token });
    expect(pairingFromHash(`#companion=http://10.0.0.1:4318&token=${token}`)).toBeUndefined();
    expect(pairingFromHash('#companion=http://127.0.0.1:4318&token=short')).toBeUndefined();
  });
});

describe('moving LOWTIDE into the companion (browser side)', () => {
  it('fills the form from a pairing link and drops the token from the address', async () => {
    const token = 'c'.repeat(43);
    const { router } = await renderApp(
      `/settings#companion=${encodeURIComponent('http://127.0.0.1:4999')}&token=${token}`,
      createDexieRepositories(newDb()),
    );
    expect(screen.getByLabelText('Companion address')).toHaveValue('http://127.0.0.1:4999');
    expect(screen.getByLabelText('Owner token')).toHaveValue(token);
    await vi.waitFor(() => expect(router.state.location.hash).toBe(''));
  });

  it('says calmly when the address is wrong or nothing answers, and moves nothing', async () => {
    const { render } = await import('@testing-library/react');
    const { createMemoryRouter } = await import('react-router');
    const { App } = await import('../app/App');
    const { routes } = await import('../app/routes');
    const userEvent = (await import('@testing-library/user-event')).default;
    const connect = vi.fn(
      () =>
        ({
          status: () => Promise.reject(new CompanionUnavailableError('http://127.0.0.1:4318')),
        }) as unknown as CompanionClient,
    );
    const user = userEvent.setup();
    render(
      <App
        repositories={createDexieRepositories(newDb())}
        router={createMemoryRouter(routes, { initialEntries: ['/settings'] })}
        companion={{ backend: { kind: 'browser' }, client: null, connect }}
      />,
    );
    const address = await screen.findByLabelText('Companion address', undefined, {
      timeout: 5000,
    });
    await user.clear(address);
    await user.type(address, 'http://example.com:4318');
    await user.type(screen.getByLabelText('Owner token'), 'd'.repeat(43));
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/on this computer/);
    expect(connect).not.toHaveBeenCalled();

    await user.clear(address);
    await user.type(address, 'http://127.0.0.1:4318');
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No companion answered/);
    expect(screen.queryByRole('button', { name: 'Download a backup' })).toBeNull();
  });
});
