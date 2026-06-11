import { useCallback, useEffect, useState } from 'react';

export type NavLayout = 'topbar' | 'sidebar';

const STORAGE_KEY = 'finanzbuddy-nav-layout';

export function getNavLayout(): NavLayout {
  if (typeof window === 'undefined') return 'topbar';
  return localStorage.getItem(STORAGE_KEY) === 'sidebar' ? 'sidebar' : 'topbar';
}

export function setNavLayout(layout: NavLayout) {
  localStorage.setItem(STORAGE_KEY, layout);
  window.dispatchEvent(new CustomEvent('finanzbuddy-nav-layout', { detail: layout }));
}

export function useNavLayout() {
  const [layout, setLayoutState] = useState<NavLayout>(() => getNavLayout());

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NavLayout>).detail;
      if (detail === 'topbar' || detail === 'sidebar') setLayoutState(detail);
    };
    window.addEventListener('finanzbuddy-nav-layout', handler);
    return () => window.removeEventListener('finanzbuddy-nav-layout', handler);
  }, []);

  const setLayout = useCallback((next: NavLayout) => {
    setNavLayout(next);
    setLayoutState(next);
  }, []);

  return { layout, setLayout };
}
