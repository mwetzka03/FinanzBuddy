import { useCallback, useState } from 'react';
import { toErrorMessage } from '../lib/errors';

export function usePageRequest() {
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { error, setError, run, clearError };
}
