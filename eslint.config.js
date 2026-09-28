import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * Storage boundary. UI and feature code reach data only through repository
 * interfaces (useRepositories()); see docs/ARCHITECTURE.md.
 * Allowed to touch the concrete database: src/db/** itself, the composition
 * root src/main.tsx, and tests. `regex` is matched against the import string.
 */
const dexiePackage = {
  name: 'dexie',
  message: 'Only src/db may import Dexie. Use a repository via useRepositories().',
};
const concreteStorage = {
  regex: '(^|/)db/(database|repositories/(dexie-[^/]+|shared))(\\.ts)?$',
  message:
    'Only src/db, src/main.tsx and tests may use the concrete database. Use useRepositories().',
};
const persistenceSchema = {
  regex: '(^|/)db/schema(\\.ts)?$',
  message:
    'Feature/UI code must not depend on persistence schemas. Use domain types and repositories.',
};

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [dexiePackage], patterns: [concreteStorage] }],
    },
  },
  {
    files: ['src/{features,components,hooks}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [dexiePackage], patterns: [concreteStorage, persistenceSchema] },
      ],
    },
  },
  {
    files: ['src/db/**/*.ts', 'src/main.tsx', 'src/test/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
