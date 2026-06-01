import { useEffect, useMemo, useState } from 'react';

import type { Account, StockPortfolioSummary } from '../lib/types';

import { DetailLink } from '../components/DetailLink';

import { formatDisplayDate, isoToday } from '../lib/date';

import { formatEurFromCents, formatSignedEurAmount, formatSignedPct, parseEurToCents } from '../lib/money';

import { createStockHolding, deleteStockHolding, listAccounts, listStockPortfolio } from '../tauri/api';

import { readStockPortfolioCache, writeStockPortfolioCache } from '../lib/stockPortfolioCache';

import { useUi } from '../lib/ui';

import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { Modal } from '../components/common/Modal';
import { useLocale } from '../i18n/LocaleProvider';
import { ListPanel } from '../components/layout/ListPanel';

import { PageShell } from '../components/layout/PageShell';

import { DateInput } from '../components/DateInput';

import { StockSuggestField } from '../components/stocks/StockSuggestField';

import { TrashIconButton } from '../components/TrashIconButton';

import type { IsoDate } from '../lib/types';



function formatEur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

const TABLE_COLS = 'minmax(120px,1.2fr) 80px 88px 96px 72px 88px 88px 96px 96px 40px';



export function StocksPage() {

  const ui = useUi();
  const { t } = useLocale();

  const [portfolio, setPortfolio] = useState<StockPortfolioSummary | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);

  const [depotFilter, setDepotFilter] = useState('');

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);



  const [name, setName] = useState('');

  const [isin, setIsin] = useState('');

  const [buyDate, setBuyDate] = useState<IsoDate>(() => isoToday());

  const [buyPrice, setBuyPrice] = useState('');

  const [shares, setShares] = useState('');

  const [depotAccountId, setDepotAccountId] = useState('');

  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [isTransfer, setIsTransfer] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);



  const depotAccounts = useMemo(

    () => accounts.filter((a) => a.balanceSource === 'stock_portfolio'),

    [accounts],

  );

  const paymentAccounts = useMemo(

    () => accounts.filter((a) => a.balanceSource === 'ledger'),

    [accounts],

  );

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);



  useEffect(() => {

    listAccounts()

      .then((rows) => {

        setAccounts(rows);

        const defaultDepot = rows.find((a) => a.balanceSource === 'stock_portfolio');

        const defaultPayment = rows.find((a) => a.name.toLowerCase().includes('traderepublic')) ?? rows.find((a) => a.balanceSource === 'ledger');

        if (defaultDepot) setDepotAccountId((prev) => prev || defaultDepot.id);

        if (defaultPayment) setPaymentAccountId((prev) => prev || defaultPayment.id);

      })

      .catch(() => undefined);

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



  async function onCreate() {

    setError(null);

    await createStockHolding({

      name: name.trim(),

      symbol: isin.trim().toUpperCase(),

      buyDate,

      buyPriceCents: parseEurToCents(buyPrice),

      shares: Number(shares.replace(',', '.')),

      depotAccountId: depotAccountId || null,

      paymentAccountId: isTransfer ? null : paymentAccountId || null,

      isTransfer,

    });

    setName('');

    setIsin('');

    setBuyPrice('');

    setShares('');

    await refresh(depotFilter, true);
    setModalOpen(false);
  }



  async function onDelete(id: string) {

    setError(null);

    await deleteStockHolding(id);

    await refresh(depotFilter, true);

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

            <div style={{ ...ui.table, minWidth: 900 }} className="fh-panel">

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

                <div />

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

                  <div style={ui.tdActions}>

                    <TrashIconButton label={t('stocks.deletePosition')} onClick={() => onDelete(row.holding.id)} />

                  </div>

                </div>

              ))}

            </div>

          </div>

        )}

      </ListPanel>

      <Modal open={modalOpen} wide title={t('stocks.newOrder')} onClose={() => setModalOpen(false)}>
        <p className="fh-form-hint">{t('stocks.formHint')}</p>
        <div className="fh-form">
          <label>
            {t('common.name')}
            <StockSuggestField
              mode="name"
              name={name}
              isin={isin}
              onNameChange={setName}
              onIsinChange={setIsin}
              placeholder="SAP SE"
            />
          </label>
          <label>
            {t('stocks.isin')}
            <StockSuggestField
              mode="isin"
              isin={isin}
              name={name}
              onIsinChange={setIsin}
              onNameChange={setName}
              placeholder="DE0007164600"
            />
          </label>
          <div className="fh-form-row">
            <label>
              {t('stocks.depotAccount')}
              <select value={depotAccountId} onChange={(e) => setDepotAccountId(e.target.value)}>
                <option value="">–</option>
                {depotAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={isTransfer ? 'fh-form-label--disabled' : undefined}>
              {t('stocks.paymentAccount')}
              <select
                value={paymentAccountId}
                onChange={(e) => setPaymentAccountId(e.target.value)}
                disabled={isTransfer}
              >
                <option value="">–</option>
                {paymentAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Checkbox
            checked={isTransfer}
            onChange={setIsTransfer}
            hint={t('stocks.isTransferHint')}
          >
            {t('stocks.isTransfer')}
          </Checkbox>
          <div className="fh-form-row">
            <label>
              {t('stocks.buyDate')}
              <DateInput value={buyDate} onChange={setBuyDate} />
            </label>
            <label>
              {t('stocks.buyPrice')}
              <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="150,00" />
            </label>
            <label>
              {t('stocks.shares')}
              <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="10" />
            </label>
          </div>
          <div className="fh-form-actions">
            <button type="button" className="fh-btn ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </button>
            <div className="fh-form-actions-right">
              <button
                type="button"
                className="fh-btn primary"
                onClick={onCreate}
                disabled={!name.trim() || !isin.trim() || !depotAccountId || (!isTransfer && !paymentAccountId)}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </PageShell>

  );

}


