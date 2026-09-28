import type { RouteObject } from 'react-router';
import { NotFound } from './NotFound';
import { RouteError } from './RouteError';
import { Shell } from './Shell';

/*
 * Each screen is its own chunk (ADR-022). The shell, router and data layer
 * stay in the entry chunk; screens load on first visit and are prefetched
 * when the browser is idle, so navigation still feels immediate.
 */
const screens = {
  today: () => import('../features/today/TodayPage'),
  inbox: () => import('../features/inbox/InboxPage'),
  tasks: () => import('../features/tasks/TasksPage'),
  rhythm: () => import('../features/rhythm/RhythmPage'),
};

/** Warms every screen chunk. Safe to call more than once. */
export function prefetchScreens(): void {
  for (const load of Object.values(screens)) void load();
}

/** Route table. Future sections (habits, …) are added as Shell children. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    // Rendered only while the very first screen chunk loads (milliseconds, locally).
    HydrateFallback: () => null,
    children: [
      { index: true, lazy: async () => ({ Component: (await screens.today()).TodayPage }) },
      { path: 'inbox', lazy: async () => ({ Component: (await screens.inbox()).InboxPage }) },
      { path: 'tasks', lazy: async () => ({ Component: (await screens.tasks()).TasksPage }) },
      { path: 'rhythm', lazy: async () => ({ Component: (await screens.rhythm()).RhythmPage }) },
      { path: '*', element: <NotFound /> },
    ],
  },
];
