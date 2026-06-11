import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DollarSign, ShoppingCart } from 'lucide-react';
import type { Account, StockChartRange, StockLot, StockPositionDetail } from '../lib/types';
import { formatDisplayDate, isoToday } from '../lib/date';
import { formatEurFromCents, formatSignedEurAmount, formatSignedPct, parseEurToCents } from '../lib/money';
import {
  deleteStockLot,
  getStockChart,
  getStockPositionDetail,
  listAccounts,
  sellStockHolding,
  updateStockLot,
} from '../tauri/api';
import { useLocale } from '../i18n/LocaleProvider';
import { useUi } from '../lib/ui';
import { StockPriceChart } from '../components/stocks/StockPriceChart';
import { StockBuyModal } from '../components/stocks/StockBuyModal';
import { Modal } from '../components/common/Modal';
import { DateInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import type { IsoDate } from '../lib/types';

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

const LOT_COLS = '100px 110px 100px 100px 110px 110px 88px';

export function StockDetailPage() {
  const ui = useUi();
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<StockPositionDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [chartRange, setChartRange] = useState<StockChartRange>('1mo');
  const [chartPoints, setChartPoints] = useState<{ timestamp: number; close: number }[]>([]);
  const [chartReference, setChartReference] = useState({ price: 0, label: 'Anfang' });
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [editLot, setEditLot] = useState<StockLot | null>(null);
  const [sellMode, setSellMode] = useState<'shares' | 'percent'>('shares');
  const [sellShares, setSellShares] = useState('');
  const [sellPercent, setSellPercent] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellFees, setSellFees] = useState('');
  const [sellDate, setSellDate] = useState<IsoDate>(() => isoToday());
  const [editBuyDate, setEditBuyDate] = useState<IsoDate>(() => isoToday());
  const [editBuyPrice, setEditBuyPrice] = useState('');
  const [editShares, setEditShares] = useState('');

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
    listAccounts()
      .then(setAccounts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!detail) return;
    setError(null);
    refreshChart(detail.position.holding.symbol, chartRange);
  }, [detail?.position.holding.symbol, chartRange]);

  useEffect(() => {
    if (!sellOpen || !detail?.position.quote) return;
    setSellPrice(detail.position.quote.price.toFixed(2).replace('.', ','));
    setSellDate(isoToday());
    setSellFees('');
    setSellShares('');
    setSellPercent('');
    setSellMode('shares');
  }, [sellOpen, detail?.position.quote?.price]);

  useEffect(() => {
    if (!editLot) return;
    setEditBuyDate(editLot.buyDate);
    setEditBuyPrice((editLot.buyPriceCents / 100).toFixed(2).replace('.', ','));
    setEditShares(String(editLot.shares));
  }, [editLot]);

  const buyPreset = useMemo(() => {
    if (!detail) return null;
    const h = detail.position.holding;
    if (!h.depotAccountId) return null;
    return { name: h.name, symbol: h.symbol, depotAccountId: h.depotAccountId };
  }, [detail]);

  const lots = detail?.lots ?? [];
  const lotsPagination = useTablePagination(lots);

  async function onDeleteLot(lotId: string) {
    if (!id) return;
    setError(null);
    await deleteStockLot(lotId);
    try {
      await refreshDetail();
    } catch {
      navigate('/aktien');
    }
  }

  async function onSaveLot() {
    if (!editLot) return;
    setError(null);
    await updateStockLot({
      id: editLot.id,
      buyDate: editBuyDate,
      buyPriceCents: parseEurToCents(editBuyPrice),
      shares: Number(editShares.replace(',', '.')),
    });
    setEditLot(null);
    await refreshDetail();
  }

  async function onSell() {
    if (!id || !detail) return;
    setError(null);
    const input =
      sellMode === 'shares'
        ? { shares: Number(sellShares.replace(',', '.')) }
        : { percent: Number(sellPercent.replace(',', '.')) };
    const stillExists = await sellStockHolding({
      holdingId: id,
      date: sellDate,
      salePriceCents: parseEurToCents(sellPrice),
      feesCents: parseEurToCents(sellFees || '0'),
      ...input,
    });
    setSellOpen(false);
    if (stillExists) {
      await refreshDetail();
    } else {
      navigate('/aktien');
    }
  }

  if (!detail) {
    return (
      <div>
        <Link to="/aktien" style={{ color: ui.colors.accentDark }}>
          ← {t('stocks.backToDepot')}
        </Link>
        <div style={{ marginTop: 16, color: ui.colors.textMuted }}>{t('common.loading')}</div>
      </div>
    );
  }

  const { position } = detail;
  const h = position.holding;

  return (
    <div style={ui.page}>
      <Link to="/aktien" style={{ color: ui.colors.accentDark, textDecoration: 'none', fontSize: 14 }}>
        ← {t('stocks.backToDepot')}
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', color: ui.colors.accentDark }}>{h.name}</h2>
          <div style={{ fontSize: 14, color: ui.colors.textMuted }}>{h.symbol}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="fh-btn ghost" onClick={() => setBuyOpen(true)} title={t('stocks.addOrder')}>
            <ShoppingCart size={18} aria-hidden />
          </button>
          <button type="button" className="fh-btn ghost" onClick={() => setSellOpen(true)} title={t('stocks.sellPosition')}>
            <DollarSign size={18} aria-hidden />
          </button>
        </div>
      </div>

      {error ? <div style={{ ...ui.errorBox, margin: '12px 0' }}>{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, margin: '16px 0' }}>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.shares')}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{h.shares}</div>
        </div>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.table.avgPrice')}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{formatEurFromCents(h.buyPriceCents)}</div>
        </div>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.table.quote')}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
            {position.quote ? formatEur(position.quote.price) : '—'}
          </div>
        </div>
        <div style={ui.card}>
          <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.gainLoss')}</div>
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
          <h3 style={{ margin: 0 }}>{t('stocks.chartTitle')}</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHART_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
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
          <div style={{ padding: 24, textAlign: 'center', color: ui.colors.textMuted }}>{t('common.loading')}</div>
        ) : (
          <StockPriceChart
            points={chartPoints}
            referencePrice={chartReference.price}
            referenceLabel={chartReference.label}
          />
        )}
      </section>

      <section style={ui.listPanel}>
        <h3 style={{ marginTop: 0 }}>{t('stocks.lotsTitle')}</h3>
        {detail.lots.length === 0 ? (
          <div style={{ color: ui.colors.textMuted }}>{t('stocks.noLots')}</div>
        ) : (
          <div style={ui.tableScroll}>
            <div style={{ ...ui.table, minWidth: 720 }}>
              <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: LOT_COLS }}>
                <div style={ui.thName}>#</div>
                <div>{t('stocks.buyDate')}</div>
                <div>{t('stocks.shares')}</div>
                <div>{t('stocks.buyPrice')}</div>
                <div>{t('stocks.table.value')}</div>
                <div>{t('stocks.table.vsBuy')}</div>
                <div />
              </div>
              <TablePaginationBar
                page={lotsPagination.page}
                totalPages={lotsPagination.totalPages}
                totalItems={lotsPagination.totalItems}
                pageSize={lotsPagination.pageSize}
                onPageChange={lotsPagination.setPage}
              />
              {lotsPagination.pageItems.map((row, idx) => (
                <div key={row.lot.id} style={{ ...ui.tableRow, gridTemplateColumns: LOT_COLS }}>
                  <div style={{ ...ui.tdName, fontWeight: 600 }}>
                    {t('stocks.lotLabel', { n: (lotsPagination.page - 1) * lotsPagination.pageSize + idx + 1 })}
                    {row.lot.isTransfer ? <span className="fh-transfer-badge">{t('stocks.transferBadge')}</span> : null}
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
                  <div style={{ ...ui.tdActions, display: 'flex', gap: 4 }}>
                    <EditIconButton label={t('stocks.editLot')} onClick={() => setEditLot(row.lot)} />
                    <TrashIconButton label={t('stocks.deleteLot')} onClick={() => onDeleteLot(row.lot.id)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {buyPreset ? (
        <StockBuyModal
          open={buyOpen}
          accounts={accounts}
          preset={buyPreset}
          onClose={() => setBuyOpen(false)}
          onCreated={async () => {
            await refreshDetail();
          }}
          onError={setError}
        />
      ) : null}

      <Modal open={!!editLot} title={t('stocks.editLot')} onClose={() => setEditLot(null)}>
        {editLot ? (
          <div className="fh-form">
            <div className="fh-form-row">
              <label>
                {t('stocks.buyDate')}
                <DateInput value={editBuyDate} onChange={setEditBuyDate} />
              </label>
              <label>
                {t('stocks.buyPrice')}
                <input value={editBuyPrice} onChange={(e) => setEditBuyPrice(e.target.value)} />
              </label>
              <label>
                {t('stocks.shares')}
                <input value={editShares} onChange={(e) => setEditShares(e.target.value)} />
              </label>
            </div>
            <div className="fh-form-actions">
              <button type="button" className="fh-btn ghost" onClick={() => setEditLot(null)}>
                {t('common.cancel')}
              </button>
              <div className="fh-form-actions-right">
                <button type="button" className="fh-btn primary" onClick={() => void onSaveLot()}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={sellOpen} title={t('stocks.sellTitle')} onClose={() => setSellOpen(false)}>
        <div className="fh-form">
          <label>
            {t('stocks.sellMode')}
            <select value={sellMode} onChange={(e) => setSellMode(e.target.value as 'shares' | 'percent')}>
              <option value="shares">{t('stocks.sellShares')}</option>
              <option value="percent">{t('stocks.sellPercent')}</option>
            </select>
          </label>
          {sellMode === 'shares' ? (
            <label>
              {t('stocks.shares')}
              <input value={sellShares} onChange={(e) => setSellShares(e.target.value)} placeholder={String(h.shares)} />
            </label>
          ) : (
            <label>
              {t('stocks.sellPercent')}
              <input value={sellPercent} onChange={(e) => setSellPercent(e.target.value)} placeholder="100" />
            </label>
          )}
          <div className="fh-form-row">
            <label>
              {t('common.date')}
              <DateInput value={sellDate} onChange={setSellDate} />
            </label>
            <label>
              {t('stocks.sellPrice')}
              <input value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
            </label>
            <label>
              {t('stocks.sellFees')}
              <input value={sellFees} onChange={(e) => setSellFees(e.target.value)} placeholder="0,00" />
            </label>
          </div>
          <div className="fh-form-actions">
            <button type="button" className="fh-btn ghost" onClick={() => setSellOpen(false)}>
              {t('common.cancel')}
            </button>
            <div className="fh-form-actions-right">
              <button type="button" className="fh-btn primary" onClick={() => void onSell()}>
                {t('stocks.sellConfirm')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
