import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { App } from '../app/App';
import { routes } from '../app/routes';
import type { Repositories } from '../db/repositories';

/** Renders the whole app at `path` with the given repositories. */
export function renderApp(path: string, repositories: Repositories) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  return { user, router, ...render(<App repositories={repositories} router={router} />) };
}
