import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { App } from '../app/App';
import { routes } from '../app/routes';
import type { Repositories } from '../db/repositories';

/**
 * Renders the whole app at `path` with the given repositories and waits until
 * the lazily loaded screen has rendered its heading.
 */
export async function renderApp(path: string, repositories: Repositories) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const result = render(<App repositories={repositories} router={router} />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
  return { user, router, ...result };
}
