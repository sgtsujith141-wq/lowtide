import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createDexieRepositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

function renderAt(path: string) {
  const repositories = createDexieRepositories(newDb());
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App repositories={repositories} router={router} />);
  return repositories;
}

describe('App foundation', () => {
  it('boots and reports the local database through the repository layer', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'LOWTIDE' })).toBeInTheDocument();
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Unprocessed inbox items').nextSibling).toHaveTextContent('0');
  });

  it('shows a way home for unknown routes', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('link', { name: 'Back to LOWTIDE' })).toHaveAttribute('href', '/');
  });
});
