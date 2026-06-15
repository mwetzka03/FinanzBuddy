import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { trackLoading } from '../lib/loading';
import { devLog } from '../lib/startupDevLog';
import type {
  Account,
  AccountBalanceSource,
  AccountKind,
  BuyItem,
  BuyItemGroup,
  BuyGroupSplitInput,
  BudgetPool,
  BudgetPoolPeriodHistory,
  BudgetPoolPeriodMode,
  BudgetPoolSplitInput,
  Cadence,
  DayView,
  FixedCost,
  IncomeForecast,
  IncomeForecastDueRule,
  DebtContactDetail,
  DebtContactSummary,
  DebtDirection,
  DebtSummary,
  ExpenseGroupDetail,
  ExpenseGroupSummary,
  IsoDate,
  IsoMonth,
  LedgerTransaction,
  LedgerExpenseSplits,
  MonthView,
  NewsArticle,
  StockNewsListResponse,
  VariableCost,
  VariableCostDetail,
  VariableCostSplitInput,
  IncomeForecastDetail,
  StockPortfolioSummary,
  StockSuggestion,
  StockPositionDetail,
  StockChart,
  StockChartRange,
  BankImportResult,
  BankImportPreview,
  ChildBalanceInput,
  PrimaryIncomeImportInput,
  DashboardPeriodMode,
  DashboardSettings,
  DataBackupResult,
} from '../lib/types';

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return trackLoading(async () => {
    const started = performance.now();
    devLog(`→ ${cmd}`, 'info', 'backend');
    try {
      const result = await tauriInvoke<T>(cmd, args);
      const ms = Math.round(performance.now() - started);
      devLog(`✓ ${cmd} (${ms} ms)`, 'ok', 'backend');
      return result;
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      devLog(`✗ ${cmd}: ${message} (${ms} ms)`, 'error', 'backend');
      throw error;
    }
  });
}

export async function listAccounts(): Promise<Account[]> {
  return await invoke('list_accounts');
}

export async function createAccount(input: {
  name: string;
  isLiquid: boolean;
  accountKind?: AccountKind;
  parentAccountId?: string | null;
  iban?: string | null;
  linkedLedgerAccountId?: string | null;
}): Promise<void> {
  await invoke('create_account', {
    input: {
      name: input.name,
      isLiquid: input.isLiquid,
      accountKind: input.accountKind ?? 'standard',
      parentAccountId: input.parentAccountId ?? null,
      iban: input.iban ?? null,
      linkedLedgerAccountId: input.linkedLedgerAccountId ?? null,
    },
  });
}

export async function updateAccount(input: {
  id: string;
  name: string;
  isLiquid: boolean;
  iban?: string | null;
  accountKind?: AccountKind;
  parentAccountId?: string | null;
}): Promise<void> {
  await invoke('update_account', { input });
}

export async function setMainAccount(id: string): Promise<void> {
  await invoke('set_main_account', { id });
}

export async function setDepotLinkedLedgerAccount(input: {
  id: string;
  linkedLedgerAccountId: string;
}): Promise<void> {
  await invoke('set_depot_linked_ledger_account', { input });
}

export async function setAccountLiquid(input: { id: string; isLiquid: boolean }): Promise<void> {
  await invoke('set_account_liquid', { id: input.id, isLiquid: input.isLiquid });
}

export async function listLedgerTransactions(input: {
  accountId?: string;
  start?: IsoDate;
  end?: IsoDate;
}): Promise<LedgerTransaction[]> {
  return await invoke('list_ledger_transactions', {
    accountId: input.accountId ?? null,
    start: input.start ?? null,
    end: input.end ?? null,
  });
}

export async function listLedgerBuyGroupSplits(ledgerId: string): Promise<BuyGroupSplitInput[]> {
  return await invoke('list_ledger_buy_group_splits', { ledgerId });
}

export async function listLedgerExpenseSplits(ledgerId: string): Promise<LedgerExpenseSplits> {
  return await invoke('list_ledger_expense_splits', { ledgerId });
}

export async function createLedgerTransaction(input: {
  date: IsoDate;
  amountCents: number;
  accountId: string;
  kind: string;
  title: string;
  notes: string | null;
  variableCostId?: string | null;
  fixedCostId?: string | null;
  buyItemId?: string | null;
  buyItemGroupId?: string | null;
  buyGroupSplits?: BuyGroupSplitInput[] | null;
  variableCostSplits?: VariableCostSplitInput[] | null;
  budgetPoolSplits?: BudgetPoolSplitInput[] | null;
  icon?: string;
  color?: string;
  assignSimilarFixedCost?: boolean;
}): Promise<void> {
  await invoke('create_ledger_transaction', { input });
}

export async function updateLedgerTransaction(input: {
  id: string;
  date: IsoDate;
  amountCents: number;
  kind: string;
  title: string;
  notes: string | null;
  variableCostId?: string | null;
  fixedCostId?: string | null;
  buyItemId?: string | null;
  buyItemGroupId?: string | null;
  buyGroupSplits?: BuyGroupSplitInput[] | null;
  variableCostSplits?: VariableCostSplitInput[] | null;
  budgetPoolSplits?: BudgetPoolSplitInput[] | null;
  icon?: string;
  color?: string;
  assignSimilarFixedCost?: boolean;
}): Promise<void> {
  await invoke('update_ledger_transaction', { input });
}

export async function deleteLedgerTransaction(id: string): Promise<void> {
  await invoke('delete_ledger_transaction', { id });
}

export async function createTransfer(input: {
  date: IsoDate;
  amountCents: number;
  fromAccountId: string;
  toAccountId: string;
  title: string;
  notes: string | null;
  icon?: string;
  color?: string;
}): Promise<void> {
  await invoke('create_transfer', { input });
}

export async function deleteTransfer(id: string): Promise<void> {
  await invoke('delete_transfer', { id });
}

export async function convertTransferToLedger(input: {
  id: string;
  date: IsoDate;
  amountCents: number;
  accountId: string;
  kind: string;
  title: string;
  notes: string | null;
  variableCostId?: string | null;
  fixedCostId?: string | null;
  icon?: string;
  color?: string;
}): Promise<void> {
  await invoke('convert_transfer_to_ledger', { input });
}

export async function convertLedgerToTransfer(input: {
  id: string;
  date: IsoDate;
  amountCents: number;
  fromAccountId: string;
  toAccountId: string;
  title: string;
  notes: string | null;
  icon?: string;
  color?: string;
}): Promise<void> {
  await invoke('convert_ledger_to_transfer', { input });
}

export async function updateTransfer(input: {
  id: string;
  date: IsoDate;
  amountCents: number;
  fromAccountId: string;
  toAccountId: string;
  title: string;
  notes: string | null;
  icon?: string;
  color?: string;
}): Promise<void> {
  await invoke('update_transfer', { input });
}

export async function getDayView(date: IsoDate, accountId?: string | null): Promise<DayView> {
  return await invoke('get_day_view', { date, accountId: accountId ?? null });
}

export async function listFixedCosts(): Promise<FixedCost[]> {
  return await invoke('list_fixed_costs');
}

export async function createFixedCost(input: Omit<FixedCost, 'id'>): Promise<void> {
  await invoke('create_fixed_cost', { input });
}

export async function updateFixedCost(input: FixedCost): Promise<void> {
  await invoke('update_fixed_cost', { input });
}

export async function deleteFixedCost(id: string): Promise<void> {
  await invoke('delete_fixed_cost', { id });
}

export async function dismissFixedCostOccurrence(input: {
  fixedCostId: string;
  occurrenceDate: IsoDate;
}): Promise<void> {
  await invoke('dismiss_fixed_cost_occurrence', { input });
}

export async function listFixedCostDismissedOccurrences(): Promise<
  { fixedCostId: string; occurrenceDate: IsoDate }[]
> {
  return await invoke('list_fixed_cost_dismissed_occurrences');
}

export async function previewFixedCost(id: string): Promise<IsoDate[]> {
  return await invoke('preview_fixed_cost', { id });
}

export async function unassignFixedCostTransaction(ledgerId: string): Promise<void> {
  await invoke('unassign_fixed_cost_transaction', { ledgerId });
}

export async function listBuyItems(): Promise<BuyItem[]> {
  return await invoke('list_buy_items');
}

export async function listBuyItemGroups(): Promise<BuyItemGroup[]> {
  return await invoke('list_buy_item_groups');
}

export async function createBuyItem(input: {
  name: string;
  description: string | null;
  amountCents: number;
  plannedMonth: IsoMonth | null;
  icon?: string;
  color?: string;
  groupId?: string | null;
}): Promise<void> {
  await invoke('create_buy_item', { input });
}

export async function updateBuyItem(input: {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  plannedMonth: IsoMonth | null;
  icon?: string;
  color?: string;
  groupId?: string | null;
}): Promise<void> {
  await invoke('update_buy_item', { input });
}

export async function createBuyItemGroup(input: {
  name: string;
  description: string | null;
  plannedMonth: IsoMonth | null;
  icon?: string;
  color?: string;
  itemIds?: string[];
}): Promise<string> {
  return await invoke('create_buy_item_group', { input });
}

export async function updateBuyItemGroup(input: {
  id: string;
  name: string;
  description: string | null;
  plannedMonth: IsoMonth | null;
  icon?: string;
  color?: string;
  itemIds?: string[];
}): Promise<void> {
  await invoke('update_buy_item_group', { input });
}

export async function deleteBuyItemGroup(id: string): Promise<void> {
  await invoke('delete_buy_item_group', { id });
}

export async function applyBuyItem(id: string, ledgerTransactionId?: string | null): Promise<void> {
  await invoke('apply_buy_item', { input: { id, ledgerTransactionId: ledgerTransactionId ?? null } });
}

export async function applyBuyItemGroup(groupId: string, ledgerTransactionId?: string | null): Promise<void> {
  await invoke('apply_buy_item_group', { input: { groupId, ledgerTransactionId: ledgerTransactionId ?? null } });
}

export async function unapplyBuyItem(id: string): Promise<void> {
  await invoke('unapply_buy_item', { id });
}

export async function deleteBuyItem(id: string): Promise<void> {
  await invoke('delete_buy_item', { id });
}

export async function listIncomeForecasts(): Promise<IncomeForecast[]> {
  return await invoke('list_income_forecasts');
}

export async function createIncomeForecast(input: {
  name: string;
  amountCents: number;
  cadence: Cadence;
  firstChargeDate: IsoDate;
  dueRule: IncomeForecastDueRule;
  dayOfMonth: number | null;
  endChargeDate: IsoDate | null;
  accountId?: string;
  icon?: string;
  color?: string;
}): Promise<void> {
  await invoke('create_income_forecast', { input });
}

export async function updateIncomeForecast(input: {
  id: string;
  name: string;
  amountCents: number;
  cadence: Cadence;
  firstChargeDate: IsoDate;
  dueRule: IncomeForecastDueRule;
  dayOfMonth: number | null;
  endChargeDate: IsoDate | null;
  active: boolean;
  accountId?: string;
  icon?: string;
  color?: string;
}): Promise<void> {
  await invoke('update_income_forecast', { input });
}

export async function linkLedgerToIncomeForecast(input: {
  ledgerTransactionId: string;
  forecastId: string;
  occurrenceDate: IsoDate;
}): Promise<void> {
  await invoke('link_ledger_to_income_forecast', { input });
}

export async function previewIncomeForecast(id: string): Promise<IsoDate[]> {
  return await invoke('preview_income_forecast', { id });
}

export async function deleteIncomeForecast(id: string): Promise<void> {
  await invoke('delete_income_forecast', { id });
}

export async function getIncomeForecastDetail(id: string): Promise<IncomeForecastDetail> {
  return await invoke('get_income_forecast_detail', { id });
}

export async function setIncomeForecastActual(input: {
  id: string;
  occurrenceDate: IsoDate;
  amountCents: number | null;
}): Promise<void> {
  await invoke('set_income_forecast_actual', { input });
}

export async function listIncomeForecastOccurrences(id: string): Promise<IsoDate[]> {
  return await invoke('list_income_forecast_occurrences', { id });
}

export async function listDashboardPeriods(): Promise<import('../lib/types').DashboardPeriodNavItem[]> {
  return await invoke('list_dashboard_periods');
}

export async function getMonthView(
  month: IsoMonth,
  accountId?: string | null,
  periodStart?: IsoDate | null,
): Promise<MonthView> {
  return await invoke('get_month_view', {
    month,
    accountId: accountId ?? null,
    periodStart: periodStart ?? null,
  });
}

export async function refreshDashboardCache(): Promise<void> {
  await invoke('refresh_dashboard_cache');
}

export async function listVariableCosts(): Promise<VariableCost[]> {
  return await invoke('list_variable_costs');
}

export async function getVariableCostDetail(id: string): Promise<VariableCostDetail> {
  return await invoke('get_variable_cost_detail', { id });
}

export async function createVariableCost(input: {
  name: string;
  amountCents: number;
  notes: string | null;
  icon?: string;
  color?: string;
  accountId?: string;
}): Promise<void> {
  await invoke('create_variable_cost', { input });
}

export async function updateVariableCost(input: {
  id: string;
  name: string;
  amountCents: number;
  notes: string | null;
  icon?: string;
  color?: string;
  accountId?: string;
}): Promise<void> {
  await invoke('update_variable_cost', { input });
}

export async function setVariableCostActual(input: {
  id: string;
  month: IsoMonth;
  amountCents: number | null;
}): Promise<void> {
  await invoke('set_variable_cost_actual', { input });
}

export async function deleteVariableCost(id: string): Promise<void> {
  await invoke('delete_variable_cost', { id });
}

export async function listBudgetPools(): Promise<BudgetPool[]> {
  return await invoke('list_budget_pools');
}

export async function getBudgetPoolPeriodHistory(poolId: string): Promise<BudgetPoolPeriodHistory> {
  return await invoke('get_budget_pool_period_history', { poolId });
}

export async function createBudgetPool(input: {
  name: string;
  amountCents: number;
  periodMode: BudgetPoolPeriodMode;
  notes: string | null;
  icon?: string;
  color?: string;
  accountId?: string;
  scalable?: boolean;
  scalableStartPeriodKey?: string | null;
}): Promise<string> {
  return await invoke('create_budget_pool', { input });
}

export async function updateBudgetPool(input: {
  id: string;
  name: string;
  amountCents: number;
  periodMode: BudgetPoolPeriodMode;
  notes: string | null;
  active: boolean;
  icon?: string;
  color?: string;
  accountId?: string;
  scalable?: boolean;
  scalableStartPeriodKey?: string | null;
}): Promise<void> {
  await invoke('update_budget_pool', { input });
}

export async function deleteBudgetPool(id: string): Promise<void> {
  await invoke('delete_budget_pool', { id });
}

export async function listExpenseGroups(): Promise<ExpenseGroupSummary[]> {
  return await invoke('list_expense_groups');
}

export async function getExpenseGroup(id: string): Promise<ExpenseGroupDetail> {
  return await invoke('get_expense_group', { id });
}

export async function createExpenseGroup(input: {
  name: string;
  date: IsoDate | null;
  notes: string | null;
  lines: { name: string; amountCents: number }[];
}): Promise<string> {
  return await invoke('create_expense_group', { input });
}

export async function updateExpenseGroup(input: {
  id: string;
  name: string;
  date: IsoDate | null;
  notes: string | null;
  lines: { id?: string; name: string; amountCents: number }[];
}): Promise<void> {
  await invoke('update_expense_group', { input });
}

export async function deleteExpenseGroup(id: string): Promise<void> {
  await invoke('delete_expense_group', { id });
}

export async function listDebtContacts(): Promise<DebtContactSummary[]> {
  return await invoke('list_debt_contacts');
}

export async function getDebtContact(id: string): Promise<DebtContactDetail> {
  return await invoke('get_debt_contact', { id });
}

export async function getDebtSummary(): Promise<DebtSummary> {
  return await invoke('get_debt_summary');
}

export async function createDebtContact(input: { name: string; notes: string | null }): Promise<string> {
  return await invoke('create_debt_contact', { input });
}

export async function updateDebtContact(input: { id: string; name: string; notes: string | null }): Promise<void> {
  await invoke('update_debt_contact', { input });
}

export async function deleteDebtContact(id: string): Promise<void> {
  await invoke('delete_debt_contact', { id });
}

export async function createDebtTransaction(input: {
  contactId: string;
  date: IsoDate;
  amountCents: number;
  direction: DebtDirection;
  title: string | null;
  notes: string | null;
}): Promise<void> {
  await invoke('create_debt_transaction', { input });
}

export async function updateDebtTransaction(input: {
  id: string;
  date: IsoDate;
  amountCents: number;
  direction: DebtDirection;
  title: string | null;
  notes: string | null;
}): Promise<void> {
  await invoke('update_debt_transaction', { input });
}

export async function deleteDebtTransaction(id: string): Promise<void> {
  await invoke('delete_debt_transaction', { id });
}

export async function listStockPortfolio(depotAccountId?: string | null): Promise<StockPortfolioSummary> {
  return await invoke('list_stock_portfolio', { depotAccountId: depotAccountId || null });
}

export async function searchStockSuggestions(
  query: string,
  mode: 'name' | 'isin' = 'name',
): Promise<StockSuggestion[]> {
  return await invoke('search_stock_suggestions', { query, mode });
}

export async function createStockHolding(input: {
  name: string;
  symbol: string;
  buyDate: IsoDate;
  buyPriceCents: number;
  shares: number;
  currency?: string;
  depotAccountId?: string | null;
  paymentAccountId?: string | null;
  isTransfer?: boolean;
}): Promise<string> {
  return await invoke('create_stock_holding', { input });
}

export async function updateStockLot(input: {
  id: string;
  buyDate: IsoDate;
  buyPriceCents: number;
  shares: number;
}): Promise<void> {
  await invoke('update_stock_lot', { input });
}

export async function sellStockHolding(input: {
  holdingId: string;
  date: IsoDate;
  shares?: number;
  percent?: number;
  salePriceCents: number;
  feesCents: number;
}): Promise<boolean> {
  return await invoke('sell_stock_holding', { input });
}

export async function deleteStockHolding(id: string): Promise<void> {
  await invoke('delete_stock_holding', { id });
}

export async function updateStockHolding(input: {
  id: string;
  name: string;
  symbol: string;
  buyDate: IsoDate;
  buyPriceCents: number;
  shares: number;
  currency?: string;
}): Promise<void> {
  await invoke('update_stock_holding', { input });
}

export async function getStockPositionDetail(
  id: string,
  options?: { skipQuotes?: boolean },
): Promise<StockPositionDetail> {
  return await invoke('get_stock_position_detail', { id, skipQuotes: options?.skipQuotes ?? null });
}

export async function getStockChart(symbol: string, range: StockChartRange): Promise<StockChart> {
  return await invoke('get_stock_chart', { symbol, range });
}

export async function deleteStockLot(id: string): Promise<void> {
  await invoke('delete_stock_lot', { id });
}

export async function listStockNews(depotAccountId?: string | null): Promise<StockNewsListResponse> {
  return await invoke('list_stock_news', { depotAccountId: depotAccountId ?? null });
}

export async function refreshStockNews(depotAccountId?: string | null): Promise<StockNewsListResponse> {
  return await invoke('refresh_stock_news', { depotAccountId: depotAccountId ?? null });
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_external_url', { url });
}

export async function previewBankExport(filePath: string): Promise<BankImportPreview> {
  return await invoke('preview_bank_export', { filePath });
}

export async function importBankExport(input: {
  filePath: string;
  accountId: string;
  currentBalanceCents?: number | null;
  balanceAsOfDate?: string | null;
  childBalances?: ChildBalanceInput[] | null;
  primaryIncome?: PrimaryIncomeImportInput | null;
}): Promise<BankImportResult> {
  return await invoke('import_bank_export', {
    filePath: input.filePath,
    accountId: input.accountId,
    currentBalanceCents: input.currentBalanceCents ?? null,
    balanceAsOfDate: input.balanceAsOfDate ?? null,
    childBalances: input.childBalances ?? null,
    primaryIncome: input.primaryIncome ?? null,
  });
}

export async function clearAllTransactions(): Promise<void> {
  await invoke('clear_all_transactions');
}

export async function resetAllUserData(): Promise<void> {
  await invoke('reset_all_user_data');
}

export async function getSetupState(): Promise<{ completed: boolean; mode: 'manual' | 'bank_import' | null }> {
  return await invoke('get_setup_state');
}

export async function completeSetup(mode: 'manual' | 'bank_import'): Promise<void> {
  await invoke('complete_setup', { mode });
}

export async function setAccountOpeningBalance(
  accountId: string,
  amountCents: number,
  asOfDate: IsoDate,
): Promise<void> {
  await invoke('set_account_opening_balance', { accountId, amountCents, asOfDate });
}

export async function exportUserData(filePath: string): Promise<DataBackupResult> {
  return await invoke('export_user_data', { filePath });
}

export async function importUserData(filePath: string): Promise<DataBackupResult> {
  return await invoke('import_user_data', { filePath });
}

export async function getDashboardSettings(): Promise<DashboardSettings> {
  return await invoke('get_dashboard_settings');
}

export async function setDashboardPeriodMode(mode: DashboardPeriodMode): Promise<void> {
  await invoke('set_dashboard_period_mode', { mode });
}

export async function setTimeframeConfig(
  isTimeframeMonth: boolean,
  incomeDate: number,
): Promise<void> {
  await invoke('set_timeframe_config', { isTimeframeMonth, incomeDate });
}

export async function setPrimaryIncomeForecast(forecastId: string | null): Promise<void> {
  await invoke('set_primary_income_forecast', { forecastId });
}
