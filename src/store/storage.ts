// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * In-memory stand-in used while rendering on the server.
 *
 * This matters more than it looks: `createJSONStorage(() => localStorage)`
 * swallows the ReferenceError thrown during SSR and returns `undefined`, and
 * zustand's persist middleware then bails out early *without* attaching
 * `api.persist`. The result is `useAppStore.persist === undefined` during
 * prerendering, which crashes every statically generated page.
 *
 * Returning a real (no-op) storage object keeps the middleware fully active on
 * both sides of the wire.
 */
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function resolveStorage(): StateStorage {
  if (typeof window === 'undefined') return noopStorage;
  try {
    // Safari private mode throws on access
    const probe = '__nc_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return noopStorage;
  }
}

export const appStorage = createJSONStorage(resolveStorage);
