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
import { StockSparkline } from '../components/stocks/StockSparkline';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { useLocale } from '../i18n/LocaleProvider';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';

function formatEur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

const TABLE_COLS = 'minmax(180px,1.4fr) 80px 88px 96px 72px 88px 88px 96px 96px';

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
  const holdings = portfolio?.holdings ?? [];
  const pagination = useTablePagination(holdings);

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
          <AmountTable minWidth={860}>
            <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
              <div style={ui.thName}>{t('stocks.table.nameIsin')}</div>
              <div style={ui.thName}>{t('stocks.depotAccount')}</div>
              <div style={ui.thMono}>{t('stocks.table.firstBuy')}</div>
              <div style={{ ...ui.thMono, textAlign: 'right' }}>{t('stocks.table.avgPrice')}</div>
              <div style={{ ...ui.thMono, textAlign: 'right' }}>{t('stocks.shares')}</div>
              <div style={{ ...ui.thMono, textAlign: 'right' }}>{t('stocks.table.quote')}</div>
              <div style={{ ...ui.thMono, textAlign: 'right' }}>{t('stocks.table.dayDelta')}</div>
              <div style={{ ...ui.thMono, textAlign: 'right' }}>{t('stocks.table.vsBuy')}</div>
              <div style={{ ...ui.thMono, textAlign: 'right' }}>{t('stocks.table.value')}</div>
            </div>
            <TablePaginationBar
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              pageSize={pagination.pageSize}
              onPageChange={pagination.setPage}
            />
            {pagination.pageItems.map((row) => {
              const refPrice = row.quote?.previousClose ?? row.sparkline?.[0]?.close ?? row.quote?.price ?? 0;
              return (
                <div key={row.holding.id} className="fh-table-row" style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                  <div style={{ ...ui.tdName, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {row.sparkline && row.sparkline.length >= 2 ? (
                      <StockSparkline points={row.sparkline} referencePrice={refPrice} />
                    ) : null}
                    <div style={{ minWidth: 0 }}>
                      <DetailLink to={`/aktien/${row.holding.id}`}>{row.holding.name}</DetailLink>
                      <div style={{ fontSize: 12, color: ui.colors.textMuted }}>{row.holding.symbol}</div>
                    </div>
                  </div>
                  <div style={{ ...ui.tdName, fontSize: 12, color: ui.colors.textMuted }}>
                    {accountMap.get(row.holding.depotAccountId ?? '') ?? '—'}
                  </div>
                  <div style={{ ...ui.tdMono, fontSize: 13 }}>{formatDisplayDate(row.holding.buyDate)}</div>
                  <div style={{ ...ui.tdMono, textAlign: 'right' }}>{formatEurFromCents(row.holding.buyPriceCents)}</div>
                  <div style={{ ...ui.tdMono, textAlign: 'right' }}>{row.holding.shares}</div>
                  <div style={{ ...ui.tdMono, textAlign: 'right' }}>{row.quote ? formatEur(row.quote.price) : '—'}</div>
                  <div
                    style={{
                      ...ui.tdMono,
                      textAlign: 'right',
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
                      textAlign: 'right',
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
                  <div style={{ ...ui.tdMono, textAlign: 'right', minWidth: 0 }}>
                    {row.currentValue != null ? formatEur(row.currentValue) : '—'}
                  </div>
                </div>
              );
            })}
          </AmountTable>
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
