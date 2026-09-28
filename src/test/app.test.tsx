import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

describe('App shell', () => {
  it('boots to the capture page with landmarks and main navigation', async () => {
    renderApp('/', createDexieRepositories(newDb()));
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Home', 'Inbox', 'Tasks']);
    expect(screen.getByRole('textbox', { name: 'What’s taking up space?' })).toHaveFocus();
    expect(await screen.findByText('Your inbox is clear.')).toBeInTheDocument();
  });

  it('marks the current section and navigates between sections', async () => {
    const { user } = renderApp('/', createDexieRepositories(newDb()));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(nav).getByRole('link', { name: 'Tasks' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('offers a skip link that moves focus to the main content', async () => {
    const { user } = renderApp('/tasks', createDexieRepositories(newDb()));
    await user.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('shows a way home for unknown routes, inside the shell', () => {
    renderApp('/nowhere', createDexieRepositories(newDb()));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to LOWTIDE' })).toHaveAttribute('href', '/');
  });
});
