import type { StockSuggestion } from '../../lib/types';
import { useUi } from '../../lib/ui';

type StockSuggestListProps = {
  suggestions: StockSuggestion[];
  searching: boolean;
  query: string;
  activeIndex: number;
  highlight: 'name' | 'isin';
  onPick: (s: StockSuggestion) => void;
};

export function StockSuggestList(props: StockSuggestListProps) {
  const { colors } = useUi();
  const { suggestions, searching, query, activeIndex, highlight, onPick } = props;

  return (
    <>
      {searching && suggestions.length === 0 && (
        <div style={{ padding: '10px 12px', fontSize: 13, color: colors.textMuted }}>Suche…</div>
      )}
      {!searching && suggestions.length === 0 && query.trim().length >= 2 && (
        <div style={{ padding: '10px 12px', fontSize: 13, color: colors.textMuted }}>Keine Treffer</div>
      )}
      {suggestions.map((s, idx) => {
        const isin = s.isin ?? s.symbol;
        const active = idx === activeIndex;
        const primary = highlight === 'isin' ? isin : s.name;
        const secondary =
          highlight === 'isin'
            ? `${s.name}${s.exchange ? ` · ${s.exchange}` : ''}`
            : `${isin}${s.exchange ? ` · ${s.exchange}` : ''}`;
        return (
          <button
            key={`${s.symbol}-${idx}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              borderTop: idx === 0 ? 'none' : `1px solid ${colors.border}`,
              background: active ? colors.accentSoft : colors.bgCard,
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, color: colors.text, fontFamily: highlight === 'isin' ? 'ui-monospace, monospace' : undefined }}>
              {primary}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{secondary}</div>
          </button>
        );
      })}
    </>
  );
}
