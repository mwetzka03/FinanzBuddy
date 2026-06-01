import { useEffect, useRef } from 'react';
import type { StockSuggestion } from '../../lib/types';
import { useUi } from '../../lib/ui';
import { StockSuggestList } from './StockSuggestList';
import { useStockSuggestions } from './useStockSuggestions';

type StockSuggestFieldProps = {
  mode: 'name' | 'isin';
  name: string;
  isin: string;
  onNameChange: (value: string) => void;
  onIsinChange: (value: string) => void;
  placeholder?: string;
};

export function StockSuggestField(props: StockSuggestFieldProps) {
  const ui = useUi();
  const { colors } = ui;
  const wrapRef = useRef<HTMLDivElement>(null);
  const query = props.mode === 'name' ? props.name : props.isin;
  const { suggestions, open, setOpen, searching, activeIndex, setActiveIndex, skipNextSearch } =
    useStockSuggestions(query, props.mode);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [setOpen]);

  function pick(s: StockSuggestion) {
    skipNextSearch();
    props.onNameChange(s.name);
    props.onIsinChange(s.isin ?? s.symbol);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pick(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const isName = props.mode === 'name';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={isName ? props.name : props.isin}
        onChange={(e) =>
          isName ? props.onNameChange(e.target.value) : props.onIsinChange(e.target.value.toUpperCase())
        }
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder ?? (isName ? 'SAP SE' : 'DE0007164600')}
        style={{ ...ui.input, ...(isName ? {} : { fontFamily: 'ui-monospace, monospace' }) }}
        autoComplete="off"
        spellCheck={isName}
        className="fh-input"
      />
      {open && (
        <div style={ui.suggestPopover}>
          <StockSuggestList
            suggestions={suggestions}
            searching={searching}
            query={query}
            activeIndex={activeIndex}
            highlight={props.mode}
            onPick={pick}
          />
        </div>
      )}
    </div>
  );
}

/** @deprecated use StockSuggestField with mode="name" */
export function StockNameSuggestField(
  props: Omit<StockSuggestFieldProps, 'mode'> & { name: string; isin: string },
) {
  return <StockSuggestField {...props} mode="name" />;
}

/** @deprecated use StockSuggestField with mode="isin" */
export function StockIsinSuggestField(
  props: Omit<StockSuggestFieldProps, 'mode'> & { name: string; isin: string },
) {
  return <StockSuggestField {...props} mode="isin" />;
}
