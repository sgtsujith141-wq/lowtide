// Provides a spec-compliant in-memory IndexedDB for jsdom, so repository tests
// exercise real Dexie against real IndexedDB semantics (transactions, indexes).
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
