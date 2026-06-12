import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account, BuyItem, BuyItemGroup, FixedCost, IncomeForecast, IsoDate, IsoMonth, LedgerTransaction, VariableCost } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { EntityIconBadge } from '../components/common/AppIcon';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { ThAmount, TdAmount } from '../components/data/AmountCells';
import { TransactionEntryModal } from '../components/transactions/TransactionEntryModal';
import { FixedCostHistoryModal } from '../components/transactions/FixedCostHistoryModal';
import { formatDisplayDate, monthEndDate, monthStartDate, toIsoMonth } from '../lib/date';
import {
  buildUnifiedEntries,
  defaultTransactionTypeFilter,
  deriveTableKindFilter,
  dueRuleShort,
  entryAmountCentsForTable,
  filterUnifiedEntriesByMonth,
  filterUnifiedEntriesByTypeFilter,
  formatEntryAmount,
  ledgerRowTitle,
  type EntryKindFilter,
  type TransactionTypeFilter,
  type UnifiedEntry,
} from '../lib/transactionList';
import {
  deleteBuyItem,
  deleteFixedCost,
  deleteIncomeForecast,
  deleteLedgerTransaction,
  deleteTransfer,
  getDashboardSettings,
  listAccounts,
  listBuyItemGroups,
  listBuyItems,
  listFixedCosts,
  listIncomeForecasts,
  listLedgerTransactions,
  listVariableCosts,
  previewFixedCost,
  previewIncomeForecast,
} from '../tauri/api';
import { stockAccentColor } from '../lib/tableAccent';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { Checkbox } from '../components/common/Checkbox';
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

function tableColumns(kindFilter: EntryKindFilter | 'multi'): string {
  if (kindFilter === 'all' || kindFilter === 'multi') {
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
  const [buyItemGroups, setBuyItemGroups] = useState<BuyItemGroup[]>([]);
  const [incomeForecasts, setIncomeForecasts] = useState<IncomeForecast[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<TransactionTypeFilter>(() => defaultTransactionTypeFilter());
  const [periodScope, setPeriodScope] = useState<'all' | 'current'>('all');
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
  const buyItemById = useMemo(() => new Map(buyItems.map((b) => [b.id, b])), [buyItems]);
  const buyItemGroupMap = useMemo(() => new Map(buyItemGroups.map((g) => [g.id, g.name])), [buyItemGroups]);
  const buyItemGroupStyleMap = useMemo(
    () => new Map(buyItemGroups.map((g) => [g.id, { icon: g.icon, color: g.color }])),
    [buyItemGroups],
  );
  const variableCostById = useMemo(() => new Map(variableCosts.map((c) => [c.id, c])), [variableCosts]);
  type TxSortKey = 'date' | 'kind' | 'title' | 'amount';
  const [sort, setSort] = useState<SortState<TxSortKey>>(null);

  const unifiedRows = useMemo(
    () =>
      buildUnifiedEntries({
        ledger: ledgerRows,
        incomeForecasts,
        fixedCosts,
        buyItems,
        accountId,
        mainAccountId,
        primaryIncomeForecastId,
        variableCostNames: variableCostMap,
        fixedCostNames: fixedCostMap,
        buyItemNames: buyItemMap,
        buyItemGroupNames: buyItemGroupMap,
        buyItemById,
        buyItemGroupById: buyItemGroupStyleMap,
        nextDatesByForecastId,
        nextDatesByFixedCostId,
      }),
    [
      ledgerRows,
      incomeForecasts,
      fixedCosts,
      buyItems,
      accountId,
      mainAccountId,
      primaryIncomeForecastId,
      variableCostMap,
      fixedCostMap,
      buyItemMap,
      buyItemGroupMap,
      buyItemById,
      buyItemGroupStyleMap,
      nextDatesByForecastId,
      nextDatesByFixedCostId,
    ],
  );

  const singleKindFilter = deriveTableKindFilter(typeFilter);
  const tableCols = tableColumns(singleKindFilter);
  const effectiveMonthFilter: IsoMonth | 'all' =
    periodScope === 'current' ? toIsoMonth(new Date()) : 'all';

  const filteredRows = useMemo(() => {
    const byKind = filterUnifiedEntriesByTypeFilter(unifiedRows, typeFilter);
    return filterUnifiedEntriesByMonth(byKind, effectiveMonthFilter);
  }, [unifiedRows, typeFilter, effectiveMonthFilter]);

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
  const pagination = useTablePagination(sortedRows);

  async function refresh() {
    const ledgerOpts =
      effectiveMonthFilter === 'all'
        ? { accountId: accountId || undefined }
        : {
            accountId: accountId || undefined,
            start: monthStartDate(effectiveMonthFilter),
            end: monthEndDate(effectiveMonthFilter),
          };
    const [ledger, forecasts, fixed, variables, buys, buyGroups] = await Promise.all([
      listLedgerTransactions(ledgerOpts),
      listIncomeForecasts(),
      listFixedCosts(),
      listVariableCosts(),
      listBuyItems(),
      listBuyItemGroups(),
    ]);
    setLedgerRows(ledger);
    setIncomeForecasts(forecasts);
    setFixedCosts(fixed);
    setVariableCosts(variables);
    setBuyItems(buys);
    setBuyItemGroups(buyGroups);

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
  }, [accountId, periodScope]);

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
    } else if (entry.source === 'buy_forecast' && entry.buyItem) {
      await deleteBuyItem(entry.buyItem.id);
    }
    await refresh();
  }

  function entryTitle(entry: UnifiedEntry): string {
    if (entry.ledger) return ledgerRowTitle(entry.ledger, accountMap, fixedCostMap, variableCostMap, buyItemMap, buyItemGroupMap);
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
            onClick={() => navigate(`/transaktionen/prognose/${entry.incomeForecast!.id}`)}
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
    if (entry.source === 'buy_forecast' && entry.buyItem) {
      return (
        <>
          <EditIconButton
            label={t('common.edit')}
            onClick={() => navigate('/buy-liste')}
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
        <div style={{ ...ui.field, width: '100%', maxWidth: 520, marginBottom: 0 }}>
          <span style={ui.label}>{t('transactions.filterType')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 6 }}>
            <Checkbox
              checked={typeFilter.income}
              onChange={(checked) => {
                setTypeFilter((prev) => {
                  if (checked || prev.expense || prev.transferAdjustment || prev.showForecasts) {
                    return { ...prev, income: checked };
                  }
                  return prev;
                });
              }}
            >
              {t('transactions.filterIncome')}
            </Checkbox>
            <Checkbox
              checked={typeFilter.expense}
              onChange={(checked) => {
                setTypeFilter((prev) => {
                  if (checked || prev.income || prev.transferAdjustment || prev.showForecasts) {
                    return { ...prev, expense: checked };
                  }
                  return prev;
                });
              }}
            >
              {t('transactions.filterExpense')}
            </Checkbox>
            <Checkbox
              checked={typeFilter.transferAdjustment}
              onChange={(checked) => {
                setTypeFilter((prev) => {
                  if (checked || prev.income || prev.expense || prev.showForecasts) {
                    return { ...prev, transferAdjustment: checked };
                  }
                  return prev;
                });
              }}
            >
              {t('transactions.filterTransferAdjustment')}
            </Checkbox>
            <Checkbox
              checked={typeFilter.showForecasts}
              onChange={(checked) => setTypeFilter((prev) => ({ ...prev, showForecasts: checked }))}
            >
              {t('transactions.showForecasts')}
            </Checkbox>
          </div>
        </div>
        <div style={{ ...ui.field, width: '100%', maxWidth: 220, marginBottom: 0 }}>
          <span style={ui.label}>{t('transactions.periodFilter')}</span>
          <div className="fh-segment stretch" role="group" aria-label={t('transactions.periodFilter')} style={{ marginTop: 6 }}>
            <button
              type="button"
              className={periodScope === 'all' ? 'active' : undefined}
              onClick={() => setPeriodScope('all')}
            >
              {t('transactions.periodAll')}
            </button>
            <button
              type="button"
              className={periodScope === 'current' ? 'active' : undefined}
              onClick={() => setPeriodScope('current')}
            >
              {t('transactions.periodCurrent')}
            </button>
          </div>
        </div>
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
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: tableCols }}>
            <div />
            <SortableTh label={t('common.date')} sortKey="date" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('common.type')} sortKey="kind" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('transactions.titleField')} sortKey="title" sort={sort} onSort={setSort} style={ui.thName} />
            {singleKindFilter === 'expense' ? <div>{t('common.category')}</div> : null}
            {singleKindFilter === 'income_forecast' || singleKindFilter === 'expense_forecast' ? (
              <>
                <div>{t('common.rhythm')}</div>
                <div>{t('common.due')}</div>
                <div>{t('common.nextDates')}</div>
              </>
            ) : null}
            <SortableTh label={t('common.amount')} sortKey="amount" sort={sort} onSort={setSort} style={ui.thAmount} align="center" />
            <div />
          </div>
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
          {sortedRows.length === 0 ? (
            <div style={{ padding: 12, color: ui.colors.textMuted }}>{t('transactions.empty')}</div>
          ) : (
            pagination.pageItems.map((entry) => {
              const accent = stockAccentColor(entry);
              return (
              <div
                key={entry.id}
                className="fh-table-row"
                style={{
                  ...ui.tableRow,
                  ...(accent ? ui.tableRowAccent(accent) : {}),
                  gridTemplateColumns: tableCols,
                }}
              >
                <EntityIconBadge
                  icon={entry.icon || DEFAULT_KIND_ICON[entry.displayKind] || 'repeat'}
                  color={entry.color || DEFAULT_KIND_COLOR[entry.displayKind] || '#6366f1'}
                  size={18}
                />
                <div style={{ fontFamily: 'monospace', textAlign: 'left' }}>{entry.date ? formatDisplayDate(entry.date) : '—'}</div>
                <div style={{ textAlign: 'left' }}>{kindLabel(entry.displayKind, t)}</div>
                <div style={ui.cellStack}>
                  {renderTitle(entry)}
                  {entry.notes ? <div style={ui.cellSub}>{entry.notes}</div> : null}
                </div>
                {singleKindFilter === 'expense' ? (
                  <div style={{ color: ui.colors.textMuted, fontSize: 13 }}>
                    {entry.categoryLabel ?? t('common.none')}
                  </div>
                ) : null}
                {singleKindFilter === 'income_forecast' || singleKindFilter === 'expense_forecast' ? (
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
              );
            })
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
        buyItemGroups={buyItemGroups}
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
