import type { ComponentType } from 'react';
import { Page, type PageWidth } from '../components/layout';
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
  calendar: () => import('../features/calendar/CalendarPage'),
  ai: () => import('../features/context/AiPage'),
  settings: () => import('../features/settings/SettingsPage'),
  space: () => import('../features/space/SpacePage'),
};

/** Warms every screen chunk. Safe to call more than once; resolves when all have loaded. */
export async function prefetchScreens(): Promise<void> {
  await Promise.all(Object.values(screens).map((load) => load()));
}

/**
 * Each screen in its frame (v2 PHASE 011): `reading` for forms and prose,
 * `standard` for lists, `wide` for grids, boards and calendars.
 */
function framed(Screen: ComponentType, width: PageWidth): ComponentType {
  return function Framed() {
    return (
      <Page width={width}>
        <Screen />
      </Page>
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
      {
        index: true,
        lazy: async () => ({ Component: framed((await screens.home()).HomePage, 'wide') }),
      },
      {
        path: 'projects',
        lazy: async () => ({ Component: framed((await screens.projects()).ProjectsPage, 'wide') }),
      },
      {
        path: 'projects/:slug',
        lazy: async () => ({ Component: framed((await screens.room()).ProjectRoom, 'wide') }),
      },
      {
        path: 'today',
        lazy: async () => ({ Component: framed((await screens.today()).TodayPage, 'standard') }),
      },
      {
        path: 'inbox',
        lazy: async () => ({ Component: framed((await screens.inbox()).InboxPage, 'reading') }),
      },
      {
        path: 'tasks',
        lazy: async () => ({ Component: framed((await screens.tasks()).TasksPage, 'standard') }),
      },
      {
        path: 'rhythm',
        lazy: async () => ({ Component: framed((await screens.rhythm()).RhythmPage, 'standard') }),
      },
      {
        path: 'data',
        lazy: async () => ({ Component: framed((await screens.data()).DataPage, 'reading') }),
      },
      {
        path: 'hackathons',
        lazy: async () => ({
          Component: framed((await screens.hackathons()).HackathonsPage, 'standard'),
        }),
      },
      {
        path: 'more',
        lazy: async () => ({ Component: framed((await screens.more()).MorePage, 'reading') }),
      },
      {
        path: 'life',
        lazy: async () => ({ Component: framed((await screens.life()).LifePage, 'wide') }),
      },
      {
        path: 'ai',
        lazy: async () => ({ Component: framed((await screens.ai()).AiPage, 'standard') }),
      },
      {
        path: 'settings',
        lazy: async () => ({
          Component: framed((await screens.settings()).SettingsPage, 'reading'),
        }),
      },
      {
        path: 'calendar',
        lazy: async () => ({ Component: framed((await screens.calendar()).CalendarPage, 'wide') }),
      },
      {
        path: 'space',
        lazy: async () => ({ Component: framed((await screens.space()).SpacePage, 'standard') }),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
