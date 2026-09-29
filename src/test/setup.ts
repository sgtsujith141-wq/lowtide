// Provides a spec-compliant in-memory IndexedDB for jsdom, so repository tests
// exercise real Dexie against real IndexedDB semantics (transactions, indexes).
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor: IndexedDB write → live query → render can take over a second
// on a loaded machine. Waits still resolve as soon as the condition holds; the
// per-test timeout (15 s, vite.config.ts) is unchanged.
configure({ asyncUtilTimeout: 3000 });

/*
 * jsdom has no layout, so no IntersectionObserver. Like a browser before you
 * scroll, nothing is "near the viewport" until a test says so with
 * `revealLazyContent()` (helpers.ts).
 */
type Observed = { callback: IntersectionObserverCallback; elements: Set<Element> };
const observers = new Set<Observed>();
(globalThis as { __lowtideObservers?: Set<Observed> }).__lowtideObservers = observers;
globalThis.IntersectionObserver = class {
  private entry: Observed;
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, elements: new Set() };
    observers.add(this.entry);
  }
  observe(el: Element) {
    this.entry.elements.add(el);
  }
  unobserve(el: Element) {
    this.entry.elements.delete(el);
  }
  disconnect() {
    observers.delete(this.entry);
  }
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
} as unknown as typeof IntersectionObserver;

afterEach(() => {
  cleanup();
});
