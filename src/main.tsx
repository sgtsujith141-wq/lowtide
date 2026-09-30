import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { App } from './app/App';
import type { CompanionState } from './app/companion-context';
import { prefetchScreens, routes } from './app/routes';
import { readBackend } from './db/companion/backend';
import { CompanionClient, createCompanionRepositories } from './db/companion/client';
import { openDatabase } from './db/database';
import { createDexieRepositories } from './db/repositories';
import { applyTheme, readTheme } from './lib/theme';
import '@fontsource-variable/geist/wght.css';
import './styles/index.css';

// Composition root: the one place the concrete storage implementation is
// chosen (ADR-058). The browser's IndexedDB, or the local companion once the
// owner has moved LOWTIDE there. Never both, and never silently.
const backend = readBackend();
const client = backend.kind === 'companion' ? new CompanionClient(backend) : null;
const repositories = client
  ? createCompanionRepositories(client)
  : createDexieRepositories(openDatabase());
const companion: CompanionState = { backend, client };
client?.start();
applyTheme(readTheme());
const router = createBrowserRouter(routes);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App repositories={repositories} router={router} companion={companion} />
  </StrictMode>,
);

// Warm the other screens once the first one is up, so switching is instant.
const idle = window.requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 200));
idle(() => void prefetchScreens());
