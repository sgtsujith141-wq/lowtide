import type { RouteObject } from 'react-router';
import { FoundationScreen } from './FoundationScreen';
import { NotFound } from './NotFound';

/** Route table. Feature routes (today, inbox, tasks, …) are added here from PHASE 001. */
export const routes: RouteObject[] = [
  { path: '/', element: <FoundationScreen /> },
  { path: '*', element: <NotFound /> },
];
