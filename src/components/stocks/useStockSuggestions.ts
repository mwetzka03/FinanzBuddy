import { useEffect, useRef, useState } from 'react';
import type { StockSuggestion } from '../../lib/types';
import { searchStockSuggestions } from '../../tauri/api';

export type StockSearchMode = 'name' | 'isin';

export function useStockSuggestions(query: string, mode: StockSearchMode) {
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipSearchRef = useRef(false);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchStockSuggestions(q, mode)
        .then((rows) => {
          if (!alive) return;
          setSuggestions(rows);
          setOpen(rows.length > 0);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (!alive) return;
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 320);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, mode]);

  function skipNextSearch() {
    skipSearchRef.current = true;
  }

  return {
    suggestions,
    open,
    setOpen,
    searching,
    activeIndex,
    setActiveIndex,
    skipNextSearch,
  };
}
