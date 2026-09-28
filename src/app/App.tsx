import { RouterProvider, type RouterProviderProps } from 'react-router';
import type { Repositories } from '../db/repositories';
import { RepositoriesContext } from './repositories-context';

interface AppProps {
  repositories: Repositories;
  router: RouterProviderProps['router'];
}

/** Root component. Dependencies are passed in so tests can supply their own. */
export function App({ repositories, router }: AppProps) {
  return (
    <RepositoriesContext value={repositories}>
      <RouterProvider router={router} />
    </RepositoriesContext>
  );
}
