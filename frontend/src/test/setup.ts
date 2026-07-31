import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Node 22+ exposes its own experimental Web Storage `localStorage` global,
 * which shadows the working one jsdom provides — and without a valid
 * `--localstorage-file` it is a stub with no methods, so any `getItem`/
 * `clear` call throws. Rather than depend on which implementation happens
 * to win, install an explicit in-memory one. Deterministic, and it isolates
 * every test from every other.
 */
function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store = new Map();
    },
  };
}

const memoryStorage = createMemoryStorage();

for (const target of [globalThis, window]) {
  Object.defineProperty(target, 'localStorage', {
    value: memoryStorage,
    writable: true,
    configurable: true,
  });
}

// Unmount anything a test rendered, so a component left mounted can't leak
// timers or state into the next test.
afterEach(() => {
  cleanup();
  memoryStorage.clear();
  vi.restoreAllMocks();
});
