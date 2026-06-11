import { useEffect, useMemo, useState } from 'react';
import type { Account, StockPortfolioSummary } from '../lib/types';
import { DetailLink } from '../components/DetailLink';
import { isDepotAccount } from '../lib/accounts';
import { formatDisplayDate } from '../lib/date';
import { formatEurFromCents, formatSignedEurAmount, formatSignedPct } from '../lib/money';
import { getStockPositionDetail, listAccounts, listStockPortfolio } from '../tauri/api';
import { mergeHoldingIntoPortfolio } from '../lib/stockPortfolioMerge';
import { readStockPortfolioCache, writeStockPortfolioCache } from '../lib/stockPortfolioCache';
import { useUi } from '../lib/ui';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { StockBuyModal } from '../components/stocks/StockBuyModal';
import { useLocale } from '../i18n/LocaleProvider';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';

function formatEur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

const TABLE_COLS = 'minmax(120px,1.2fr) 80px 88px 96px 72px 88px 88px 96px 96px';

export function StocksPage() {
  const ui = useUi();
  const { t } = useLocale();

  const [portfolio, setPortfolio] = useState<StockPortfolioSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [depotFilter, setDepotFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const depotAccounts = useMemo(() => accounts.filter((a) => isDepotAccount(a)), [accounts]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  useEffect(() => {
    listAccounts().then(setAccounts).catch(() => undefined);
  }, []);

  async function refresh(filter = depotFilter, force = false) {
    if (!force) {
      const cached = readStockPortfolioCache(filter);
      if (cached) {
        setPortfolio(cached);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listStockPortfolio(filter || null);
      writeStockPortfolioCache(filter, data);
      setPortfolio(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const cached = readStockPortfolioCache(depotFilter);
    if (cached) {
      setPortfolio(cached);
      return;
    }
    refresh(depotFilter, true);
  }, [depotFilter]);

  async function onHoldingCreated(holdingId: string) {
    const detail = await getStockPositionDetail(holdingId);
    setPortfolio((prev) => {
      if (!prev) return prev;
      const next = mergeHoldingIntoPortfolio(prev, detail.position);
      writeStockPortfolioCache(depotFilter, next);
      return next;
    });
  }

  return (
    <PageShell
      title={t('stocks.depotTitle')}
      intro={t('stocks.intro')}
      error={error}
      headerActions={<AddEntryButton label={t('stocks.newOrder')} onClick={() => setModalOpen(true)} />}
    >
      <div style={{ ...ui.toolbar, marginBottom: 16 }}>
        <label style={{ ...ui.field, width: 260 }}>
          <span style={ui.label}>{t('stocks.depotFilter')}</span>
          <select value={depotFilter} onChange={(e) => setDepotFilter(e.target.value)} style={ui.input}>
            <option value="">{t('stocks.allDepots')}</option>
            {depotAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {portfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, marginBottom: 20 }}>
          <div style={ui.statCard} className="fh-stat-card fh-panel">
            <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.totalCost')}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{formatEur(portfolio.totalCostBasis)}</div>
          </div>
          <div style={ui.statCard} className="fh-stat-card fh-panel">
            <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.totalValue')}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{formatEur(portfolio.totalCurrentValue)}</div>
          </div>
          <div style={ui.statCard} className="fh-stat-card fh-panel">
            <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.gainLoss')}</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 6,
                color: portfolio.totalGainLoss >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative,
              }}
            >
              {formatSignedEurAmount(portfolio.totalGainLoss)} ({formatSignedPct(portfolio.totalGainLossPct)})
            </div>
          </div>
          <div style={ui.statCard} className="fh-stat-card fh-panel">
            <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{t('stocks.pricesEur')}</div>
            <div style={{ fontSize: 13, marginTop: 6, color: ui.colors.textMuted }}>
              {loading ? t('stocks.refreshing') : t('stocks.priceHint')}
            </div>
            <button style={{ ...ui.btn, marginTop: 8 }} onClick={() => refresh(depotFilter, true)} disabled={loading}>
              {t('stocks.refreshPrices')}
            </button>
          </div>
        </div>
      )}

      <ListPanel hint={t('stocks.listHint')}>
        {!portfolio ? (
          <div style={{ color: ui.colors.textMuted }}>{t('common.loading')}</div>
        ) : portfolio.holdings.length === 0 ? (
          <div style={{ color: ui.colors.textMuted }}>{t('stocks.noHoldings')}</div>
        ) : (
          <div style={ui.tableScroll}>
            <div style={{ ...ui.table, minWidth: 860 }} className="fh-panel">
              <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
                <div style={ui.thName}>{t('stocks.table.nameIsin')}</div>
                <div>{t('stocks.depotAccount')}</div>
                <div>{t('stocks.table.firstBuy')}</div>
                <div>{t('stocks.table.avgPrice')}</div>
                <div>{t('stocks.shares')}</div>
                <div>{t('stocks.table.quote')}</div>
                <div>{t('stocks.table.dayDelta')}</div>
                <div>{t('stocks.table.vsBuy')}</div>
                <div>{t('stocks.table.value')}</div>
              </div>
              {portfolio.holdings.map((row) => (
                <div key={row.holding.id} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                  <div style={ui.tdName}>
                    <DetailLink to={`/aktien/${row.holding.id}`}>{row.holding.name}</DetailLink>
                    <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{row.holding.symbol}</div>
                  </div>
                  <div style={{ ...ui.tdCenter, fontSize: 12, color: ui.colors.textMuted }}>
                    {accountMap.get(row.holding.depotAccountId ?? '') ?? '—'}
                  </div>
                  <div style={{ ...ui.tdMono, fontSize: 13 }}>{formatDisplayDate(row.holding.buyDate)}</div>
                  <div style={ui.tdMono}>{formatEurFromCents(row.holding.buyPriceCents)}</div>
                  <div style={ui.tdMono}>{row.holding.shares}</div>
                  <div style={ui.tdMono}>{row.quote ? formatEur(row.quote.price) : '—'}</div>
                  <div
                    style={{
                      ...ui.tdMono,
                      color: row.quote && row.quote.dayChange >= 0 ? ui.colors.amountPositive : ui.colors.amountNegative,
                    }}
                  >
                    {row.quote ? (
                      <>
                        {formatSignedEurAmount(row.quote.dayChange)}
                        <br />
                        <span style={{ fontSize: 11 }}>{formatSignedPct(row.quote.dayChangePct)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
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
                  <div style={{ ...ui.tdMono, minWidth: 0 }}>
                    {row.currentValue != null ? formatEur(row.currentValue) : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ListPanel>

      <StockBuyModal
        open={modalOpen}
        accounts={accounts}
        defaultDepotAccountId={depotFilter || depotAccounts[0]?.id}
        onClose={() => setModalOpen(false)}
        onCreated={onHoldingCreated}
        onError={setError}
      />
    </PageShell>
  );
}
