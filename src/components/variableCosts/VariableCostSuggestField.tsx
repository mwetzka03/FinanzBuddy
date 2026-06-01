import { useEffect, useMemo, useRef, useState } from 'react';
import type { VariableCost } from '../../lib/types';
import { useUi } from '../../lib/ui';

type VariableCostSuggestFieldProps = {
  costs: VariableCost[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function VariableCostSuggestField({
  costs,
  value,
  onChange,
  placeholder,
  disabled,
}: VariableCostSuggestFieldProps) {
  const ui = useUi();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selected = useMemo(() => costs.find((c) => c.id === value) ?? null, [costs, value]);

  useEffect(() => {
    setQuery(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return costs.slice(0, 12);
    return costs.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12);
  }, [costs, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(cost: VariableCost) {
    onChange(cost.id);
    setQuery(cost.name);
    setOpen(false);
    setActiveIndex(-1);
  }

  function clear() {
    onChange(null);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function onInputChange(next: string) {
    setQuery(next);
    setOpen(true);
    setActiveIndex(-1);
    if (!next.trim()) {
      onChange(null);
      return;
    }
    const exact = costs.find((c) => c.name.toLowerCase() === next.trim().toLowerCase());
    onChange(exact?.id ?? null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
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
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Variable Kosten wählen…'}
          disabled={disabled}
          style={ui.input}
          autoComplete="off"
          className="fh-input"
        />
        {value ? (
          <button type="button" style={ui.btn} onClick={clear} disabled={disabled}>
            ×
          </button>
        ) : null}
      </div>
      {open && suggestions.length > 0 && !disabled ? (
        <div style={ui.suggestPopover}>
          {suggestions.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                background: i === activeIndex ? ui.colors.accentSoft : 'transparent',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
