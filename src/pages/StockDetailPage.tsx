import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StockChartRange, StockPositionDetail } from '../lib/types';
import { formatDisplayDate } from '../lib/date';
import { formatEurFromCents, formatSignedEurAmount, formatSignedPct } from '../lib/money';
import { deleteStockLot, getStockChart, getStockPositionDetail } from '../tauri/api';
import { useLocale } from '../i18n/LocaleProvider';
import { useUi } from '../lib/ui';
import { StockPriceChart } from '../components/stocks/StockPriceChart';
import { TrashIconButton } from '../components/TrashIconButton';

const CHART_RANGES: { id: StockChartRange; label: string }[] = [
  { id: '1d', label: 'Tag' },
  { id: '5d', label: 'Woche' },
  { id: '1mo', label: 'Monat' },
  { id: '1y', label: 'Jahr' },
  { id: 'max', label: 'Max' },
];

function formatEur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

const LOT_COLS = '100px 110px 100px 100px 110px 110px 80px';

export function StockDetailPage() {
  const ui = useUi();
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<StockPositionDetail | null>(null);
  const [chartRange, setChartRange] = useState<StockChartRange>('1mo');
  const [chartPoints, setChartPoints] = useState<{ timestamp: number; close: number }[]>([]);
  const [chartReference, setChartReference] = useState({ price: 0, label: 'Anfang' });
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshDetail() {
    if (!id) return;
    setDetail(await getStockPositionDetail(id));
  }

  async function refreshChart(symbol: string, range: StockChartRange) {
    setChartLoading(true);
    try {
      const chart = await getStockChart(symbol, range);
      setChartPoints(chart.points);
      setChartReference({ price: chart.referencePrice, label: chart.referenceLabel });
    } catch (e) {
      setChartPoints([]);
      setChartReference({ price: 0, label: 'Anfang' });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChartLoading(false);
    }
  }

  useEffect(() => {
    refreshDetail().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    if (!detail) return;
    setError(null);
    refreshChart(detail.position.holding.symbol, chartRange);
  }, [detail?.position.holding.symbol, chartRange]);

  async function onDeleteLot(lotId: string) {
    if (!id) return;
    setError(null);
    await deleteStockLot(lotId);
    try {
      setDetail(await getStockPositionDetail(id));
    } catch {
      navigate('/aktien');
    }
  }

  if (!detail) {
    return (
      <div>
        <Link to="/aktien" style={{ color: ui.colors.accentDark }}>
          ← Zurück
        </Link>
        <div style={{ marginTop: 16, color: ui.colors.textMuted }}>Lade…</div>
      </div>
    );
  }

  const { position } = detail;
  const h = position.holding;

  return (
    <div style={ui.page}>
      <Link to="/aktien" style={{ color: ui.colors.accentDark, textDecoration: 'none', fontSize: 14 }}>
        ← Aktien-Depot
      </Link>

      <h2 style={{ margin: '12px 0 4px', color: ui.colors.accentDark }}>{h.name}</h2>
      <div style={{ fontSize: 14, color: ui.colors.textMuted, marginBottom: 16 }}>{h.symbol}</div>

      {error && <div style={{ ...ui.errorBox, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>Stück (gesamt)</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{h.shares}</div>
        </div>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>Ø Kaufpreis</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{formatEurFromCents(h.buyPriceCents)}</div>
        </div>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>Aktueller Kurs</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
            {position.quote ? formatEur(position.quote.price) : '—'}
          </div>
        </div>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>Gewinn / Verlust</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginTop: 6,
              color: position.gainLoss != null && position.gainLoss >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative,
            }}
          >
            {position.gainLoss != null && position.gainLossPct != null
              ? `${formatSignedEurAmount(position.gainLoss)} (${formatSignedPct(position.gainLossPct)})`
              : '—'}
          </div>
        </div>
      </div>

      <section style={{ ...ui.listPanel, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Kursverlauf (EUR)</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHART_RANGES.map((r) => (
              <button
                key={r.id}
                style={{
                  ...ui.btn,
                  background: chartRange === r.id ? ui.colors.accentSoft : undefined,
                  fontWeight: chartRange === r.id ? 600 : 400,
                }}
                onClick={() => setChartRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {chartLoading ? (
          <div style={{ padding: 24, textAlign: 'center', color: ui.colors.textMuted }}>Chart lädt…</div>
        ) : (
          <StockPriceChart
            points={chartPoints}
            referencePrice={chartReference.price}
            referenceLabel={chartReference.label}
          />
        )}
      </section>

      <section style={ui.listPanel}>
        <h3 style={{ marginTop: 0 }}>Einzelaufträge</h3>
        {detail.lots.length === 0 ? (
          <div style={{ color: ui.colors.textMuted }}>Keine Aufträge erfasst.</div>
        ) : (
          <div style={ui.tableScroll}>
            <div style={{ ...ui.table, minWidth: 720 }}>
              <div style={{ ...ui.tableHead, gridTemplateColumns: LOT_COLS }}>
                <div style={ui.thName}>#</div>
                <div>Kaufdatum</div>
                <div>Stück</div>
                <div>Kaufpreis</div>
                <div>Wert</div>
                <div>Differenz</div>
                <div />
              </div>
              {detail.lots.map((row, idx) => (
                <div key={row.lot.id} style={{ ...ui.tableRow, gridTemplateColumns: LOT_COLS }}>
                  <div style={{ ...ui.tdName, fontWeight: 600 }}>
                    Auftrag {idx + 1}
                    {row.lot.isTransfer ? (
                      <span className="fh-transfer-badge">{t('stocks.transferBadge')}</span>
                    ) : null}
                  </div>
                  <div style={{ ...ui.tdMono, fontSize: 13 }}>{formatDisplayDate(row.lot.buyDate)}</div>
                  <div style={ui.tdMono}>{row.lot.shares}</div>
                  <div style={ui.tdMono}>{formatEurFromCents(row.lot.buyPriceCents)}</div>
                  <div style={ui.tdMono}>{row.currentValue != null ? formatEur(row.currentValue) : '—'}</div>
                  <div
                    style={{
                      ...ui.tdMono,
                      color: row.gainLoss != null && row.gainLoss >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative,
                    }}
                  >
                    {row.gainLoss != null && row.gainLossPct != null ? (
                      <>
                        {formatSignedEurAmount(row.gainLoss)}
                        <br />
                        <span style={{ fontSize: 11 }}>{formatSignedPct(row.gainLossPct)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                  <div style={ui.tdActions}>
                    <TrashIconButton label="Auftrag löschen" onClick={() => onDeleteLot(row.lot.id)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
