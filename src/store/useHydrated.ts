// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useSyncExternalStore } from 'react';
import { useAppStore } from '@/store/useAppStore';

/**
 * Zustand is configured with `skipHydration`, so on the very first render the
 * store still holds its defaults. Anything that renders persisted state
 * (theme swatch, active layout, selected token) must gate on this hook or
 * React reports a hydration mismatch.
 *
 * `useSyncExternalStore` is the correct primitive here: it subscribes to the
 * persist middleware and re-renders exactly once when hydration finishes —
 * no cascading `setState` inside effects.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const persistApi = useAppStore.persist;
      if (!persistApi) {
        onStoreChange();
        return () => {};
      }
      return persistApi.onFinishHydration(onStoreChange);
    },
    // client snapshot
    () => useAppStore.persist?.hasHydrated() ?? true,
    // server snapshot – never hydrated during SSG
    () => false,
  );
}

/**
 * Triggers the deferred rehydration. Call exactly once from a mounted client
 * component (<StoreBridge /> does this). Kept separate from `useHydrated` so
 * subscribing and side-effecting stay decoupled.
 */
export function rehydrateStore(): void {
  void useAppStore.persist?.rehydrate();
}
