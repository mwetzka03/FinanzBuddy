import { useEffect } from 'react';

export function useAsyncLoad(load: () => Promise<void>) {
  useEffect(() => {
    load().catch(() => {
      /* Fehlerbehandlung erfolgt in load() via usePageRequest.run */
    });
  }, [load]);
}
