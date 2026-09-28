import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { App } from './app/App';
import { routes } from './app/routes';
import { openDatabase } from './db/database';
import { createDexieRepositories } from './db/repositories';
import './styles/index.css';

// Composition root: the one place the concrete storage implementation is chosen.
const repositories = createDexieRepositories(openDatabase());
const router = createBrowserRouter(routes);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App repositories={repositories} router={router} />
  </StrictMode>,
);
