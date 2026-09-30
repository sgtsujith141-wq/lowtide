import { RouterProvider, type RouterProviderProps } from 'react-router';
import type { Repositories } from '../db/repositories';
import { CompanionContext, type CompanionState } from './companion-context';
import { RepositoriesContext } from './repositories-context';

interface AppProps {
  repositories: Repositories;
  router: RouterProviderProps['router'];
  /** Companion mode (ADR-058); browser storage when absent. */
  companion?: CompanionState;
}

const BROWSER: CompanionState = { backend: { kind: 'browser' }, client: null };

/** Root component. Dependencies are passed in so tests can supply their own. */
export function App({ repositories, router, companion = BROWSER }: AppProps) {
  return (
    <CompanionContext value={companion}>
      <RepositoriesContext value={repositories}>
        <RouterProvider router={router} />
      </RepositoriesContext>
    </CompanionContext>
  );
}
