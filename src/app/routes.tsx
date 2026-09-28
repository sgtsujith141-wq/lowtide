import type { RouteObject } from 'react-router';
import { HomePage } from '../features/home/HomePage';
import { InboxPage } from '../features/inbox/InboxPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { NotFound } from './NotFound';
import { RouteError } from './RouteError';
import { Shell } from './Shell';

/** Route table. Future sections (Today, habits, …) are added as Shell children. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
