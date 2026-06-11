export type IsoDate = `${number}-${number}-${number}`;
export type IsoMonth = `${number}-${number}`;

export type Cadence = 'yearly' | 'monthly' | 'weekly' | 'biweekly' | 'once';

export type BuyItemStatus = 'parked' | 'applied';

export type AccountBalanceSource = 'ledger' | 'stock_portfolio';

export type AccountKind = 'standard' | 'spartopf' | 'oberspartopf' | 'depot';

export interface Account {
  id: string;
  name: string;
  isLiquid: boolean;
  balanceSource: AccountBalanceSource;
  accountKind: AccountKind;
  parentAccountId: string | null;
  iban: string | null;
  isMain: boolean;
  linkedLedgerAccountId: string | null;
  createdAt: string;
}

export type LedgerKind = 'income' | 'expense' | 'transfer' | 'fixed_cost' | 'buy_apply' | 'buy_planned' | 'adjustment' | 'forecast';

export interface LedgerTransaction {
  id: string;
  date: IsoDate;
  amountCents: number;
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  kind: LedgerKind | string;
  title: string;
  notes: string | null;
  sourceId: string | null;
  variableCostId: string | null;
  fixedCostId: string | null;
  buyItemId: string | null;
  buyItemGroupId: string | null;
  icon: string;
  color: string;
  createdAt: string;
}

export type FixedCostDueRule = 'calendar_day' | 'first_business_day' | 'last_business_day';

export interface FixedCost {
  id: string;
  name: string;
  amountCents: number;
  cadence: Cadence;
  firstChargeDate: IsoDate;
  active: boolean;
  notes: string | null;
  dueRule: FixedCostDueRule;
  dayOfMonth: number | null;
  endChargeDate: IsoDate | null;
  accountId: string;
  icon: string;
  color: string;
}

export interface BuyItem {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  status: BuyItemStatus;
  appliedDate: IsoDate | null;
  plannedMonth: IsoMonth | null;
  icon: string;
  color: string;
  groupId: string | null;
  createdAt: string;
}

export interface BuyItemGroup {
  id: string;
  name: string;
  description: string | null;
  plannedMonth: IsoMonth | null;
  icon: string;
  color: string;
  createdAt: string;
}

export type IncomeForecastDueRule = 'calendar_day' | 'first_business_day' | 'last_business_day';

export interface IncomeForecast {
  id: string;
  name: string;
  amountCents: number;
  cadence: Cadence;
  firstChargeDate: IsoDate;
  dueRule: IncomeForecastDueRule;
  dayOfMonth: number | null;
  endChargeDate: IsoDate | null;
  active: boolean;
  accountId: string;
  icon: string;
  color: string;
}

export interface IncomeForecastDetail {
  forecast: IncomeForecast;
  actuals: IncomeForecastActual[];
}

export interface IncomeForecastActual {
  occurrenceDate: IsoDate;
  amountCents: number;
}

export interface VariableCost {
  id: string;
  name: string;
  amountCents: number;
  notes: string | null;
  icon: string;
  color: string;
  createdAt: string;
  accountId: string;
  currentMonthForecastCents: number;
  currentMonthActualCents: number;
  currentMonthSpentCents: number;
  currentMonth: IsoMonth;
  currentMonthClosed: boolean;
}

export interface VariableCostActual {
  month: IsoMonth;
  amountCents: number;
  actualSource: 'manual' | 'transactions' | null;
}

export interface VariableCostCategorizedTransaction {
  id: string;
  date: IsoDate;
  title: string;
  amountCents: number;
  notes: string | null;
}

export interface VariableCostDetail {
  cost: VariableCost;
  actuals: VariableCostActual[];
  transactions: VariableCostCategorizedTransaction[];
}

export type EventType = 'fixed_cost' | 'variable_cost' | 'buy_applied' | 'buy_planned' | 'income' | 'transfer' | 'expense' | 'adjustment' | 'forecast' | 'buy_apply';

export interface TimelineEvent {
  id: string;
  type: EventType | string;
  date: IsoDate;
  title: string;
  amountCents: number;
  accountId?: string | null;
  accountName?: string | null;
  internalTransfer?: boolean;
  fixedCostId?: string | null;
  variableCostId?: string | null;
  notes?: string | null;
  buyItemId?: string | null;
  buyItemGroupId?: string | null;
}

export type DashboardPeriodMode = 'calendar_month' | 'since_last_salary';

export interface DashboardPeriodNavItem {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  isCurrent: boolean;
}

export interface DashboardSettings {
  periodMode: DashboardPeriodMode;
  isTimeframeMonth: boolean;
  incomeDate: number;
  primaryIncomeForecastId: string | null;
  minMonth: IsoMonth;
  currentPeriodStart?: IsoDate | null;
  minPeriodStart?: IsoDate | null;
}

export interface MonthView {
  month: IsoMonth;
  startBalanceCents: number;
  incomeCents: number;
  fixedCostsCents: number;
  variableCostsCents: number;
  remainingFixedCostsCents: number;
  remainingVariableCostsCents: number;
  appliedBuysCents: number;
  transfersCents: number;
  endBalanceCents: number;
  startLiquidCents: number;
  totalLiquidCents: number;
  kontostandCents: number;
  kontostandSaldoCents: number;
  kontostandAsOf: IsoDate;
  kontostandStartCents: number;
  kontostandStartSaldoCents: number;
  prevKontostandCents: number;
  periodMode: 'calendar_month' | 'since_last_salary';
  periodStart: IsoDate;
  periodEnd: IsoDate;
  salaryCutoffDate?: IsoDate | null;
  periodIsCurrent: boolean;
  bookedFixedCostsCents: number;
  bookedVariableCostsCents: number;
  events: TimelineEvent[];
}

export interface DayView {
  date: IsoDate;
  totalCents: number;
  liquidCents: number;
  kontostandCents: number;
  prevKontostandCents: number;
  events: TimelineEvent[];
}

export interface ExpenseGroupLine {
  id: string;
  name: string;
  amountCents: number;
}

export interface ExpenseGroupSummary {
  id: string;
  name: string;
  date: IsoDate | null;
  notes: string | null;
  totalCents: number;
  lineCount: number;
  createdAt: string;
}

export interface ExpenseGroupDetail {
  group: ExpenseGroupSummary;
  lines: ExpenseGroupLine[];
}

export type DebtDirection = 'owed_to_me' | 'i_owe';

export interface DebtContactSummary {
  id: string;
  name: string;
  notes: string | null;
  owedToMeCents: number;
  iOweCents: number;
  createdAt: string;
}

export interface DebtTransaction {
  id: string;
  contactId: string;
  date: IsoDate;
  amountCents: number;
  direction: DebtDirection;
  title: string | null;
  notes: string | null;
  createdAt: string;
}

export interface DebtContactDetail {
  contact: DebtContactSummary;
  transactions: DebtTransaction[];
}

export interface DebtSummary {
  owedToMeCents: number;
  iOweCents: number;
}

export interface StockHolding {
  id: string;
  name: string;
  symbol: string;
  buyDate: IsoDate;
  buyPriceCents: number;
  shares: number;
  currency: string;
  depotAccountId?: string | null;
  createdAt: string;
}

export interface StockQuote {
  symbol: string;
  price: number;
  currency: string;
  previousClose: number;
  dayChange: number;
  dayChangePct: number;
}

export interface StockHoldingView {
  holding: StockHolding;
  quote: StockQuote | null;
  currentValue: number | null;
  costBasis: number;
  gainLoss: number | null;
  gainLossPct: number | null;
}

export interface StockPortfolioSummary {
  holdings: StockHoldingView[];
  totalCostBasis: number;
  totalCurrentValue: number;
  totalGainLoss: number;
  totalGainLossPct: number;
}

export interface StockSuggestion {
  name: string;
  symbol: string;
  isin: string | null;
  exchange: string;
}

export interface StockLot {
  id: string;
  holdingId: string;
  buyDate: IsoDate;
  buyPriceCents: number;
  shares: number;
  paymentAccountId?: string | null;
  isTransfer: boolean;
  createdAt: string;
}

export interface StockLotView {
  lot: StockLot;
  costBasis: number;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
}

export interface StockPositionDetail {
  position: StockHoldingView;
  lots: StockLotView[];
}

export type StockChartRange = '1d' | '5d' | '1mo' | '1y' | 'max';

export interface StockChartPoint {
  timestamp: number;
  close: number;
}

export interface StockChart {
  range: StockChartRange;
  currency: string;
  referencePrice: number;
  referenceLabel: string;
  points: StockChartPoint[];
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  url: string;
  source: string;
  publishedAt: string;
  category: 'market' | 'depot' | string;
  symbol: string | null;
}

export interface StockNewsListResponse {
  depotArticles: NewsArticle[];
  marketArticles: NewsArticle[];
  cachedAt: string | null;
  refreshing: boolean;
}

export interface BankImportResult {
  format: string;
  iban: string | null;
  importedCount: number;
  skippedCount: number;
  transferCount: number;
  openingBalanceSet: boolean;
  closingBalanceCents: number | null;
  closingBalanceDate: string | null;
  message: string;
  warnings: string[];
}

export interface BankImportPreviewTransaction {
  index: number;
  date: string;
  amountCents: number;
  title: string;
  notes: string | null;
  counterpartyIban: string | null;
}

export interface BankImportPreview {
  format: string;
  iban: string | null;
  transactions: BankImportPreviewTransaction[];
  incomeIndices: number[];
}

export interface ChildBalanceInput {
  accountId: string;
  currentBalanceCents: number;
}

export interface PrimaryIncomeImportInput {
  transactionIndex?: number | null;
  forecastName: string;
  forecastAmountCents: number;
  useImportAmount: boolean;
  dueRule?: IncomeForecastDueRule | null;
  dayOfMonth?: number | null;
  employerIban?: string | null;
}

export interface DataBackupResult {
  filePath: string;
  tableCount: number;
  rowCount: number;
  message: string;
}
