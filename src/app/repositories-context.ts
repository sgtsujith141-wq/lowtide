import { createContext } from 'react';
import type { Repositories } from '../db/repositories';

export const RepositoriesContext = createContext<Repositories | null>(null);
