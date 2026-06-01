import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'finanzbuddy-dev-mode';

interface DeveloperModeContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const DeveloperModeContext = createContext<DeveloperModeContextValue | null>(null);

function readStored(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function DeveloperModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => readStored());

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);

  return <DeveloperModeContext.Provider value={value}>{children}</DeveloperModeContext.Provider>;
}

export function useDeveloperMode(): DeveloperModeContextValue {
  const ctx = useContext(DeveloperModeContext);
  if (!ctx) throw new Error('useDeveloperMode must be used within DeveloperModeProvider');
  return ctx;
}

export function isDeveloperModeEnabled(): boolean {
  return readStored();
}
