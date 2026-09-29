import type { ComponentType } from 'react';
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
  home: () => import('../features/home/HomePage'),
  projects: () => import('../features/projects/ProjectsPage'),
  room: () => import('../features/projects/ProjectRoom'),
  today: () => import('../features/today/TodayPage'),
  inbox: () => import('../features/inbox/InboxPage'),
  tasks: () => import('../features/tasks/TasksPage'),
  rhythm: () => import('../features/rhythm/RhythmPage'),
  hackathons: () => import('../features/hackathons/HackathonsPage'),
  data: () => import('../features/backup/DataPage'),
  more: () => import('../features/home/MorePage'),
  life: () => import('../features/life/LifePage'),
};

/** Warms every screen chunk. Safe to call more than once. */
export function prefetchScreens(): void {
  for (const load of Object.values(screens)) void load();
}

/** v0.1 screens keep their reading width inside the wider v2 frame. */
function narrow(Page: ComponentType): ComponentType {
  return function Narrow() {
    return (
      <div className="max-w-2xl">
        <Page />
      </div>
    );
  };
}

/** Route table (ADR-043): Home at `/`, Today at `/today`. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    // Rendered only while the very first screen chunk loads (milliseconds, locally).
    HydrateFallback: () => null,
    children: [
      { index: true, lazy: async () => ({ Component: (await screens.home()).HomePage }) },
      {
        path: 'projects',
        lazy: async () => ({ Component: (await screens.projects()).ProjectsPage }),
      },
      {
        path: 'projects/:slug',
        lazy: async () => ({ Component: (await screens.room()).ProjectRoom }),
      },
      {
        path: 'today',
        lazy: async () => ({ Component: narrow((await screens.today()).TodayPage) }),
      },
      {
        path: 'inbox',
        lazy: async () => ({ Component: narrow((await screens.inbox()).InboxPage) }),
      },
      {
        path: 'tasks',
        lazy: async () => ({ Component: narrow((await screens.tasks()).TasksPage) }),
      },
      {
        path: 'rhythm',
        lazy: async () => ({ Component: narrow((await screens.rhythm()).RhythmPage) }),
      },
      { path: 'data', lazy: async () => ({ Component: narrow((await screens.data()).DataPage) }) },
      {
        path: 'hackathons',
        lazy: async () => ({ Component: narrow((await screens.hackathons()).HackathonsPage) }),
      },
      { path: 'more', lazy: async () => ({ Component: (await screens.more()).MorePage }) },
      { path: 'life', lazy: async () => ({ Component: (await screens.life()).LifePage }) },
      { path: '*', element: <NotFound /> },
    ],
  },
];
