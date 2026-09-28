import { useContext } from 'react';
import { RepositoriesContext } from '../app/repositories-context';
import type { Repositories } from '../db/repositories';

/** The data layer for components. The only way UI code reaches storage. */
export function useRepositories(): Repositories {
  const repositories = useContext(RepositoriesContext);
  if (!repositories) {
    throw new Error('useRepositories must be used inside <RepositoriesContext.Provider>');
  }
  return repositories;
}
