import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account, BuyItem, FixedCost, IncomeForecast, IsoDate, IsoMonth, LedgerTransaction, VariableCost } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { EntityIconBadge } from '../components/common/AppIcon';
import { AmountTable } from '../components/data/AmountTable';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { ThAmount, TdAmount } from '../components/data/AmountCells';
import { TransactionEntryModal } from '../components/transactions/TransactionEntryModal';
import { FixedCostHistoryModal } from '../components/transactions/FixedCostHistoryModal';
import { formatDisplayDate, monthEndDate, monthStartDate, toIsoMonth } from '../lib/date';
import {
  buildUnifiedEntries,
  dueRuleShort,
  ENTRY_KIND_FILTERS,
  entryAmountCentsForTable,
  filterUnifiedEntries,
  filterUnifiedEntriesByMonth,
  formatEntryAmount,
  kindFilterLabel,
  ledgerRowTitle,
  type EntryKindFilter,
  type UnifiedEntry,
} from '../lib/transactionList';
import {
  deleteFixedCost,
  deleteIncomeForecast,
  deleteLedgerTransaction,
  deleteTransfer,
  getDashboardSettings,
  listAccounts,
  listBuyItems,
  listFixedCosts,
  listIncomeForecasts,
  listLedgerTransactions,
  listVariableCosts,
  previewFixedCost,
  previewIncomeForecast,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { MonthInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { useLocale } from '../i18n/LocaleProvider';
import { DEFAULT_KIND_COLOR, DEFAULT_KIND_ICON } from '../lib/icons';
import { DashboardAccountSelect } from '../components/dashboard/DashboardAccountSelect';

function kindLabel(kind: string, t: (key: string) => string): string {
  const key = `transactions.kinds.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
}

function isEditableLedgerKind(kind: string): boolean {
  return !['buy_apply', 'buy_planned', 'fixed_cost'].includes(kind);
}

function tableColumns(kindFilter: EntryKindFilter): string {
  if (kindFilter === 'all') {
    return '48px 120px 120px minmax(200px, 2fr) 120px 72px';
  }
  if (kindFilter === 'expense') {
    return '48px 120px 120px minmax(180px, 1.5fr) minmax(140px, 1fr) 120px 72px';
  }
  if (kindFilter === 'income_forecast' || kindFilter === 'expense_forecast') {
    return '48px 120px 120px minmax(160px, 1.2fr) 120px 140px 120px minmax(160px, 1fr) 120px 72px';
  }
  return '48px 120px 120px minmax(200px, 2fr) 120px 72px';
}

export function TransactionsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [variableCosts, setVariableCosts] = useState<VariableCost[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [buyItems, setBuyItems] = useState<BuyItem[]>([]);
  const [incomeForecasts, setIncomeForecasts] = useState<IncomeForecast[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<EntryKindFilter>('all');
  const [monthFilter, setMonthFilter] = useState<IsoMonth | 'all'>('all');
  const [ledgerRows, setLedgerRows] = useState<LedgerTransaction[]>([]);
  const [nextDatesByForecastId, setNextDatesByForecastId] = useState<Map<string, IsoDate[]>>(new Map());
  const [nextDatesByFixedCostId, setNextDatesByFixedCostId] = useState<Map<string, IsoDate[]>>(new Map());
  const [primaryIncomeForecastId, setPrimaryIncomeForecastId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<LedgerTransaction | null>(null);
  const [historyFixedCost, setHistoryFixedCost] = useState<FixedCost | null>(null);

  const ledgerAccounts = useMemo(() => accounts.filter((a) => a.balanceSource === 'ledger'), [accounts]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const mainAccountId = useMemo(
    () => ledgerAccounts.find((a) => a.isMain)?.id ?? ledgerAccounts[0]?.id ?? '',
    [ledgerAccounts],
  );
  const effectiveAccountId = accountId || mainAccountId;
  const selectedAccount = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
  const isStockDepot = selectedAccount?.balanceSource === 'stock_portfolio';
  const variableCostMap = useMemo(() => new Map(variableCosts.map((c) => [c.id, c.name])), [variableCosts]);
  const fixedCostMap = useMemo(() => new Map(fixedCosts.map((c) => [c.id, c.name])), [fixedCosts]);
  const fixedCostById = useMemo(() => new Map(fixedCosts.map((c) => [c.id, c])), [fixedCosts]);
  const buyItemMap = useMemo(() => new Map(buyItems.map((b) => [b.id, b.name])), [buyItems]);
  const variableCostById = useMemo(() => new Map(variableCosts.map((c) => [c.id, c])), [variableCosts]);
  type TxSortKey = 'date' | 'kind' | 'title' | 'amount';
  const [sort, setSort] = useState<SortState<TxSortKey>>(null);

  const unifiedRows = useMemo(
    () =>
      buildUnifiedEntries({
        ledger: ledgerRows,
        incomeForecasts,
        fixedCosts,
        accountId,
        mainAccountId,
        primaryIncomeForecastId,
        variableCostNames: variableCostMap,
        fixedCostNames: fixedCostMap,
        buyItemNames: buyItemMap,
        nextDatesByForecastId,
        nextDatesByFixedCostId,
      }),
    [
      ledgerRows,
      incomeForecasts,
      fixedCosts,
      accountId,
      mainAccountId,
      primaryIncomeForecastId,
      variableCostMap,
      fixedCostMap,
      buyItemMap,
      nextDatesByForecastId,
      nextDatesByFixedCostId,
    ],
  );

  const tableCols = tableColumns(kindFilter);

  const filteredRows = useMemo(() => {
    const byKind = filterUnifiedEntries(unifiedRows, kindFilter);
    return filterUnifiedEntriesByMonth(byKind, monthFilter);
  }, [unifiedRows, kindFilter, monthFilter]);

  const sortedRows = useMemo(
    () =>
      sortByState(filteredRows, sort, {
        date: (e) => e.sortDate ?? e.date ?? '',
        kind: (e) => e.displayKind,
        title: (e) => entryTitle(e),
        amount: (e) => entryAmountCentsForTable(e),
      }),
    [filteredRows, sort],
  );

  async function refresh() {
    const ledgerOpts =
      monthFilter === 'all'
        ? { accountId: accountId || undefined }
        : {
            accountId: accountId || undefined,
            start: monthStartDate(monthFilter),
            end: monthEndDate(monthFilter),
          };
    const [ledger, forecasts, fixed, variables, buys] = await Promise.all([
      listLedgerTransactions(ledgerOpts),
      listIncomeForecasts(),
      listFixedCosts(),
      listVariableCosts(),
      listBuyItems(),
    ]);
    setLedgerRows(ledger);
    setIncomeForecasts(forecasts);
    setFixedCosts(fixed);
    setVariableCosts(variables);
    setBuyItems(buys);

    const forecastDates = new Map<string, IsoDate[]>();
    await Promise.all(
      forecasts.map(async (row) => {
        try {
          forecastDates.set(row.id, await previewIncomeForecast(row.id));
        } catch {
          forecastDates.set(row.id, []);
        }
      }),
    );
    setNextDatesByForecastId(forecastDates);

    const fixedDates = new Map<string, IsoDate[]>();
    await Promise.all(
      fixed.map(async (row) => {
        try {
          fixedDates.set(row.id, await previewFixedCost(row.id));
        } catch {
          fixedDates.set(row.id, []);
        }
      }),
    );
    setNextDatesByFixedCostId(fixedDates);
  }

  useEffect(() => {
    listAccounts()
      .then((a) => {
        setAccounts(a);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    getDashboardSettings()
      .then((s) => setPrimaryIncomeForecastId(s.primaryIncomeForecastId))
      .catch(() => setPrimaryIncomeForecastId(null));
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [accountId, monthFilter]);

  function openCreate() {
    setEditingRow(null);
    setModalOpen(true);
  }

  function openEditLedger(row: LedgerTransaction) {
    setEditingRow(row);
    setModalOpen(true);
  }

  async function onDeleteEntry(entry: UnifiedEntry) {
    setError(null);
    if (entry.source === 'ledger' && entry.ledger) {
      if (entry.ledger.kind === 'transfer') {
        await deleteTransfer(entry.ledger.id);
      } else {
        await deleteLedgerTransaction(entry.ledger.id);
      }
    } else if (entry.source === 'income_forecast' && entry.incomeForecast) {
      await deleteIncomeForecast(entry.incomeForecast.id);
    } else if (entry.source === 'expense_forecast' && entry.fixedCost) {
      await deleteFixedCost(entry.fixedCost.id);
    }
    await refresh();
  }

  function entryTitle(entry: UnifiedEntry): string {
    if (entry.ledger) return ledgerRowTitle(entry.ledger, accountMap, fixedCostMap, variableCostMap, buyItemMap);
    return entry.title;
  }

  function variableCostForEntry(entry: UnifiedEntry): VariableCost | null {
    const id = entry.ledger?.variableCostId;
    return id ? variableCostById.get(id) ?? null : null;
  }

  function renderActions(entry: UnifiedEntry) {
    if (entry.source === 'ledger' && entry.ledger) {
      if (!isEditableLedgerKind(entry.ledger.kind)) return null;
      return (
        <>
          <EditIconButton label={t('common.edit')} onClick={() => openEditLedger(entry.ledger!)} />
          <TrashIconButton
            label={entry.ledger.kind === 'transfer' ? t('transactions.undoTransfer') : t('common.delete')}
            onClick={() => onDeleteEntry(entry)}
          />
        </>
      );
    }
    if (entry.source === 'income_forecast' && entry.incomeForecast) {
      return (
        <>
          <EditIconButton
            label={t('common.edit')}
            onClick={() => navigate(`/einnahmen/prognose/${entry.incomeForecast!.id}`)}
          />
          <TrashIconButton label={t('common.delete')} onClick={() => onDeleteEntry(entry)} />
        </>
      );
    }
    if (entry.source === 'expense_forecast' && entry.fixedCost) {
      return (
        <>
          <EditIconButton
            label={t('common.edit')}
            onClick={() => navigate('/fixkosten', { state: { editId: entry.fixedCost!.id } })}
          />
          <TrashIconButton label={t('common.delete')} onClick={() => onDeleteEntry(entry)} />
        </>
      );
    }
    return null;
  }

  function fixedCostForEntry(entry: UnifiedEntry): FixedCost | null {
    if (entry.fixedCost) return entry.fixedCost;
    const id = entry.ledger?.fixedCostId;
    return id ? fixedCostById.get(id) ?? null : null;
  }

  function renderTitle(entry: UnifiedEntry) {
    const fixedCost = fixedCostForEntry(entry);
    const variableCost = variableCostForEntry(entry);
    const title = entryTitle(entry);
    if (fixedCost) {
      return (
        <button
          type="button"
          className="fh-link-button"
          style={ui.nameLink}
          onClick={() => setHistoryFixedCost(fixedCost)}
        >
          {title}
        </button>
      );
    }
    if (variableCost) {
      return (
        <button
          type="button"
          className="fh-link-button"
          style={ui.nameLink}
          onClick={() => navigate(`/variable-kosten/${variableCost.id}`)}
        >
          {title}
        </button>
      );
    }
    return <div>{title}</div>;
  }

  return (
    <PageShell title={t('transactions.title')} intro={t('transactions.intro')} error={error}>
      <div className="fh-transactions-toolbar">
        <DashboardAccountSelect accounts={ledgerAccounts} value={accountId} onChange={setAccountId} />
        <label style={{ ...ui.field, width: '100%', maxWidth: 300, marginBottom: 0 }}>
          <span style={ui.label}>{t('transactions.filterType')}</span>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as EntryKindFilter)} style={ui.input}>
            {ENTRY_KIND_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {kindFilterLabel(filter, t)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...ui.field, width: '100%', maxWidth: 220, marginBottom: 0 }}>
          <span style={ui.label}>{t('common.month')}</span>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value === 'all' ? 'all' : (e.target.value as IsoMonth))}
            style={ui.input}
          >
            <option value="all">{t('transactions.filterAll')}</option>
            <option value={toIsoMonth(new Date())}>{t('transactions.filterCurrentMonth')}</option>
          </select>
        </label>
        {monthFilter !== 'all' ? (
          <label style={{ ...ui.field, width: '100%', maxWidth: 180, marginBottom: 0 }}>
            <span style={ui.label}>{t('transactions.monthPick')}</span>
            <MonthInput value={monthFilter} onChange={setMonthFilter} />
          </label>
        ) : null}
        {!isStockDepot ? (
          <div className="fh-transactions-toolbar__actions">
            <AddEntryButton label={t('transactions.newEntry')} onClick={openCreate} disabled={!effectiveAccountId} />
          </div>
        ) : null}
      </div>

      {isStockDepot && (
        <p style={{ margin: '0 0 16px', color: ui.colors.textMuted, fontSize: 14 }}>{t('transactions.stockDepotHint')}</p>
      )}

      <ListPanel title={t('transactions.history')} hint={t('transactions.historyHint')}>
        <AmountTable>
          <div style={{ ...ui.tableHead, gridTemplateColumns: tableCols }}>
            <div />
            <SortableTh label={t('common.date')} sortKey="date" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('common.type')} sortKey="kind" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('transactions.titleField')} sortKey="title" sort={sort} onSort={setSort} style={ui.thName} />
            {kindFilter === 'expense' ? <div>{t('common.category')}</div> : null}
            {kindFilter === 'income_forecast' || kindFilter === 'expense_forecast' ? (
              <>
                <div>{t('common.rhythm')}</div>
                <div>{t('common.due')}</div>
                <div>{t('common.nextDates')}</div>
              </>
            ) : null}
            <SortableTh label={t('common.amount')} sortKey="amount" sort={sort} onSort={setSort} style={ui.thAmount} align="right" />
            <div />
          </div>
          {sortedRows.length === 0 ? (
            <div style={{ padding: 12, color: ui.colors.textMuted }}>{t('transactions.empty')}</div>
          ) : (
            sortedRows.map((entry) => (
              <div key={entry.id} style={{ ...ui.tableRow, gridTemplateColumns: tableCols }}>
                <EntityIconBadge
                  icon={entry.icon || DEFAULT_KIND_ICON[entry.displayKind] || 'target'}
                  color={entry.color || DEFAULT_KIND_COLOR[entry.displayKind] || '#6366f1'}
                  size={18}
                />
                <div style={{ fontFamily: 'monospace', textAlign: 'left' }}>{entry.date ? formatDisplayDate(entry.date) : '—'}</div>
                <div style={{ textAlign: 'left' }}>{kindLabel(entry.displayKind, t)}</div>
                <div style={ui.cellStack}>
                  {renderTitle(entry)}
                  {entry.notes ? <div style={ui.cellSub}>{entry.notes}</div> : null}
                </div>
                {kindFilter === 'expense' ? (
                  <div style={{ color: ui.colors.textMuted, fontSize: 13 }}>
                    {entry.categoryLabel ?? t('common.none')}
                  </div>
                ) : null}
                {kindFilter === 'income_forecast' || kindFilter === 'expense_forecast' ? (
                  <>
                    <div>{entry.cadence ? t(`cadence.${entry.cadence}`) : '—'}</div>
                    <div style={{ fontSize: 13 }}>
                      {entry.dueRule ? dueRuleShort(entry.dueRule, entry.dayOfMonth, t) : '—'}
                    </div>
                    <div style={{ fontSize: 13, color: ui.colors.textMuted }}>
                      {entry.nextDates?.length
                        ? entry.nextDates.slice(0, 3).map((d) => formatDisplayDate(d)).join(', ')
                        : t('common.none')}
                    </div>
                  </>
                ) : null}
                <TdAmount
                  col="amount"
                  amountCents={entryAmountCentsForTable(entry)}
                  neutral={entry.displayKind === 'transfer'}
                >
                  {formatEntryAmount(entry)}
                </TdAmount>
                <div style={ui.tdActions}>{renderActions(entry)}</div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <FixedCostHistoryModal
        open={historyFixedCost !== null}
        fixedCost={historyFixedCost}
        ledger={ledgerRows}
        accounts={accounts}
        onClose={() => setHistoryFixedCost(null)}
        onChanged={refresh}
      />

      <TransactionEntryModal
        open={modalOpen}
        row={editingRow}
        accountId={effectiveAccountId}
        accounts={accounts}
        variableCosts={variableCosts}
        fixedCosts={fixedCosts}
        buyItems={buyItems}
        incomeForecasts={incomeForecasts}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await refresh();
        }}
        onError={setError}
      />
    </PageShell>
  );
}
