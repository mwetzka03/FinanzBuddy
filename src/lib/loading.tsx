import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { devLog } from './startupDevLog';
import { isDeveloperModeEnabled } from './developerMode';

type LoadingContextValue = {
  pending: number;
  isLoading: boolean;
  trackLoading: <T>(fn: () => Promise<T>) => Promise<T>;
};

const LoadingContext = createContext<LoadingContextValue | null>(null);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [pending, setPending] = useState(0);
  const routeGeneration = useRef(0);
  const activeTasks = useRef(0);

  useEffect(() => {
    routeGeneration.current += 1;
    activeTasks.current = 0;
    setPending(0);
  }, [location.pathname]);

  const trackLoading = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const generation = routeGeneration.current;
    activeTasks.current += 1;
    if (activeTasks.current === 1 && isDeveloperModeEnabled()) {
      devLog(`Lade ${location.pathname}…`, 'info', 'loading');
    }
    setPending(activeTasks.current);
    try {
      return await fn();
    } finally {
      if (generation === routeGeneration.current) {
        activeTasks.current = Math.max(0, activeTasks.current - 1);
        if (activeTasks.current === 0 && isDeveloperModeEnabled()) {
          devLog(`Fertig: ${location.pathname}`, 'ok', 'loading');
        }
        setPending(activeTasks.current);
      }
    }
  }, [location.pathname]);

  const value = useMemo(
    () => ({
      pending,
      isLoading: pending > 0,
      trackLoading,
    }),
    [pending, trackLoading],
  );

  useEffect(() => {
    registerGlobalLoadingTracker(trackLoading);
    return () => registerGlobalLoadingTracker(async (fn) => fn());
  }, [trackLoading]);

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return ctx;
}

/** Für api.ts — trackt alle Tauri-Aufrufe und steuert die Ladeanimation. */
let globalTrackLoading: LoadingContextValue['trackLoading'] | null = null;

export function registerGlobalLoadingTracker(tracker: LoadingContextValue['trackLoading']) {
  globalTrackLoading = tracker;
}

export async function trackLoading<T>(fn: () => Promise<T>): Promise<T> {
  if (globalTrackLoading) {
    return globalTrackLoading(fn);
  }
  return fn();
}
