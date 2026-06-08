import { useEffect, useMemo, useState } from 'react';
import type {
  Account,
  Cadence,
  FixedCost,
  FixedCostDueRule,
  IncomeForecast,
  IncomeForecastDueRule,
  IsoDate,
  LedgerTransaction,
  VariableCost,
} from '../../lib/types';
import { Checkbox } from '../common/Checkbox';
import { ColorPicker, IconPicker } from '../common/AppIcon';
import { Modal } from '../common/Modal';
import { DateInput } from '../DateInput';
import { OptionalDescriptionInput } from '../OptionalDescriptionInput';
import {
  ExpenseCategoryField,
  expenseCategoryFromLedger,
  ledgerCategoryIds,
  type ExpenseCategoryValue,
} from './ExpenseCategoryField';
import { formatDisplayDate, isoToday } from '../../lib/date';
import { parseEurToCents } from '../../lib/money';
import { parseIncomeForecastSourceId } from '../../lib/transactionList';
import {
  createFixedCost,
  createIncomeForecast,
  createLedgerTransaction,
  createTransfer,
  convertLedgerToTransfer,
  convertTransferToLedger,
  linkLedgerToIncomeForecast,
  listIncomeForecastOccurrences,
  updateLedgerTransaction,
  updateTransfer,
} from '../../tauri/api';
import { useLocale } from '../../i18n/LocaleProvider';
import { DEFAULT_KIND_COLOR, DEFAULT_KIND_ICON } from '../../lib/icons';
import { useUi } from '../../lib/ui';

type LedgerKind = 'income' | 'expense' | 'adjustment';
type EditEntryType = LedgerKind | 'transfer';
type CreateEntryType = LedgerKind | 'income_forecast' | 'expense_forecast' | 'transfer';

const INCOME_CADENCE: Cadence[] = ['once', 'yearly', 'monthly', 'weekly', 'biweekly'];
const INCOME_DUE_RULES: IncomeForecastDueRule[] = ['calendar_day', 'first_business_day', 'last_business_day'];
const EXPENSE_DUE_RULES: FixedCostDueRule[] = ['calendar_day', 'first_business_day', 'last_business_day'];

function dayFromIso(iso: string): string {
  return iso.split('-')[2]?.replace(/^0/, '') ?? '1';
}

function kindLabel(kind: string, t: (key: string) => string): string {
  const key = `transactions.kinds.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
}

function amountCentsForKind(k: LedgerKind, cents: number): number {
  if (k === 'adjustment') return Math.abs(cents);
  if (k === 'income') return Math.abs(cents);
  return -Math.abs(cents);
}

function canAssignCategory(kind: string): boolean {
  return kind === 'expense';
}

function isLedgerCreateType(type: CreateEntryType): type is LedgerKind {
  return type === 'income' || type === 'expense' || type === 'adjustment';
}

export function TransactionEntryModal({
  open,
  row,
  accountId,
  accounts,
  variableCosts,
  fixedCosts,
  incomeForecasts,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  row: LedgerTransaction | null;
  accountId: string;
  accounts: Account[];
  variableCosts: VariableCost[];
  fixedCosts: FixedCost[];
  incomeForecasts: IncomeForecast[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const ui = useUi();
  const isEdit = !!row;

  const ledgerAccounts = useMemo(() => accounts.filter((a) => a.balanceSource === 'ledger'), [accounts]);
  const allAccountOptions = useMemo(() => accounts.map((a) => ({ id: a.id, name: a.name })), [accounts]);
  const mainAccountId = useMemo(
    () => ledgerAccounts.find((a) => a.isMain)?.id ?? ledgerAccounts[0]?.id ?? '',
    [ledgerAccounts],
  );

  const [entryType, setEntryType] = useState<CreateEntryType | EditEntryType>('expense');
  const [date, setDate] = useState(isoToday());
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryValue>({ kind: 'none', id: null });
  const [icon, setIcon] = useState(DEFAULT_KIND_ICON.expense);
  const [color, setColor] = useState(DEFAULT_KIND_COLOR.expense);

  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');

  const [forecastName, setForecastName] = useState('');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [firstChargeDate, setFirstChargeDate] = useState<IsoDate>(isoToday());
  const [dueRule, setDueRule] = useState<IncomeForecastDueRule | FixedCostDueRule>('calendar_day');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endChargeDate, setEndChargeDate] = useState<IsoDate>(isoToday());
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [incomeForecastAccountId, setIncomeForecastAccountId] = useState('');
  const [linkForecastId, setLinkForecastId] = useState('');
  const [linkOccurrenceDate, setLinkOccurrenceDate] = useState<IsoDate | ''>('');
  const [linkOccurrences, setLinkOccurrences] = useState<IsoDate[]>([]);

  const editableIncomeForecasts = useMemo(
    () =>
      incomeForecasts.filter(
        (f) => f.active && (!row?.accountId || f.accountId === row.accountId || f.accountId === accountId),
      ),
    [incomeForecasts, row?.accountId, accountId],
  );

  useEffect(() => {
    if (!open) return;
    const today = isoToday();
    if (row) {
      setDate(row.date);
      setAmount((Math.abs(row.amountCents) / 100).toFixed(2).replace('.', ','));
      setTitle(row.title);
      setDescription(row.notes ?? '');
      if (row.kind === 'transfer') {
        setEntryType('transfer');
        setFromAccountId(row.fromAccountId ?? '');
        setToAccountId(row.toAccountId ?? '');
      } else if (row.kind === 'income' || row.kind === 'expense' || row.kind === 'adjustment') {
        setEntryType(row.kind);
        setFromAccountId(row.accountId ?? (accountId || mainAccountId));
        setToAccountId('');
      } else {
        setEntryType('expense');
        setFromAccountId(row.accountId ?? (accountId || mainAccountId));
        setToAccountId('');
      }
      setExpenseCategory(expenseCategoryFromLedger(row.variableCostId, row.fixedCostId));
      setIcon(row.icon || DEFAULT_KIND_ICON[row.kind] || 'target');
      setColor(row.color || DEFAULT_KIND_COLOR[row.kind] || '#6366f1');
      const linked = parseIncomeForecastSourceId(row.sourceId);
      setLinkForecastId(linked?.forecastId ?? '');
      setLinkOccurrenceDate(linked?.occurrenceDate ?? '');
      return;
    }

    setEntryType('expense');
    setDate(today);
    setAmount('');
    setTitle('');
    setDescription('');
    setExpenseCategory({ kind: 'none', id: null });
    setIcon(DEFAULT_KIND_ICON.expense);
    setColor(DEFAULT_KIND_COLOR.expense);
    setFromAccountId(accountId || mainAccountId);
    setToAccountId('');
    setForecastName('');
    setCadence('monthly');
    setFirstChargeDate(today);
    setDueRule('calendar_day');
    setDayOfMonth(dayFromIso(today));
    setHasEndDate(false);
    setEndChargeDate(today);
    setExpenseAccountId(accountId || mainAccountId);
    setIncomeForecastAccountId(accountId || mainAccountId);
    setLinkForecastId('');
    setLinkOccurrenceDate('');
  }, [open, row, accountId, mainAccountId]);

  useEffect(() => {
    if (!open || !linkForecastId) {
      setLinkOccurrences([]);
      return;
    }
    listIncomeForecastOccurrences(linkForecastId)
      .then(setLinkOccurrences)
      .catch(() => setLinkOccurrences([]));
  }, [open, linkForecastId]);

  function onEntryTypeChange(next: CreateEntryType | EditEntryType) {
    setEntryType(next);
    if (next === 'transfer' && row) {
      if (row.kind === 'transfer') {
        setFromAccountId(row.fromAccountId ?? '');
        setToAccountId(row.toAccountId ?? '');
      } else if (row.accountId) {
        const isOutflow = row.amountCents < 0 || row.kind === 'expense';
        if (isOutflow) {
          setFromAccountId(row.accountId);
          setToAccountId('');
        } else {
          setFromAccountId('');
          setToAccountId(row.accountId);
        }
      }
      setExpenseCategory({ kind: 'none', id: null });
    } else if (
      row?.kind === 'transfer' &&
      (next === 'income' || next === 'expense' || next === 'adjustment')
    ) {
      if (next === 'income') {
        setFromAccountId(row.toAccountId ?? row.fromAccountId ?? '');
      } else if (next === 'expense') {
        setFromAccountId(row.fromAccountId ?? row.toAccountId ?? '');
      } else {
        setFromAccountId(row.toAccountId ?? row.fromAccountId ?? '');
      }
      setToAccountId('');
      setExpenseCategory({ kind: 'none', id: null });
    } else if (isLedgerCreateType(next as CreateEntryType) || next === 'income' || next === 'expense' || next === 'adjustment') {
      const ledgerKind = next as LedgerKind;
      setIcon(DEFAULT_KIND_ICON[ledgerKind] ?? 'target');
      setColor(DEFAULT_KIND_COLOR[ledgerKind] ?? '#6366f1');
      if (!canAssignCategory(ledgerKind)) {
        setExpenseCategory({ kind: 'none', id: null });
      }
    }
  }

  function onFirstPaymentChange(value: IsoDate) {
    setFirstChargeDate(value);
    if (dueRule === 'calendar_day') {
      setDayOfMonth(dayFromIso(value));
    }
  }

  const dayOfMonthDisabled =
    dueRule !== 'calendar_day' || cadence === 'weekly' || cadence === 'biweekly';

  const lockedKind = isEdit && row?.kind === 'buy_apply';
  const showTransferFields = entryType === 'transfer';
  const showIncomeForecastFields = !isEdit && entryType === 'income_forecast';
  const showExpenseForecastFields = !isEdit && entryType === 'expense_forecast';
  const showIncomeForecastLink = isEdit && !!row && row.kind === 'income' && editableIncomeForecasts.length > 0;
  const showLedgerFields =
    entryType !== 'transfer' && (isEdit || isLedgerCreateType(entryType as CreateEntryType));

  async function save() {
    onError(null);
    try {
      if (isEdit && row) {
        if (entryType === 'transfer') {
          if (!fromAccountId || !toAccountId || !amount.trim()) return;
          const transferInput = {
            id: row.id,
            date,
            amountCents: parseEurToCents(amount),
            fromAccountId,
            toAccountId,
            title: title.trim() || t('accounts.defaultTransferTitle'),
            notes: description.trim() ? description : null,
          };
          if (row.kind === 'transfer') {
            await updateTransfer(transferInput);
          } else {
            await convertLedgerToTransfer(transferInput);
          }
        } else if (row.kind === 'transfer') {
          if (!fromAccountId || !amount.trim()) return;
          const cents = parseEurToCents(amount);
          const ledgerKind = entryType as LedgerKind;
          await convertTransferToLedger({
            id: row.id,
            date,
            amountCents: amountCentsForKind(ledgerKind, cents),
            accountId: fromAccountId,
            kind: ledgerKind,
            title: title.trim() || kindLabel(ledgerKind, t),
            notes: description.trim() ? description : null,
            ...ledgerCategoryIds(canAssignCategory(ledgerKind) ? expenseCategory : { kind: 'none', id: null }),
            icon,
            color,
          });
          if (ledgerKind === 'income' && linkForecastId && linkOccurrenceDate) {
            await linkLedgerToIncomeForecast({
              ledgerTransactionId: row.id,
              forecastId: linkForecastId,
              occurrenceDate: linkOccurrenceDate,
            });
          }
        } else if (!amount.trim()) {
          return;
        } else {
          const cents = parseEurToCents(amount);
          let amountCents: number;
          let finalKind = row.kind;
          if (row.kind === 'buy_apply') {
            amountCents = -Math.abs(cents);
          } else if (row.kind === 'income' || row.kind === 'expense' || row.kind === 'adjustment') {
            finalKind = entryType as LedgerKind;
            amountCents = amountCentsForKind(entryType as LedgerKind, cents);
          } else {
            amountCents = row.amountCents;
          }
          await updateLedgerTransaction({
            id: row.id,
            date,
            amountCents,
            kind: finalKind,
            title: title.trim() || kindLabel(finalKind, t),
            notes: description.trim() ? description : null,
            ...ledgerCategoryIds(canAssignCategory(finalKind) ? expenseCategory : { kind: 'none', id: null }),
            icon,
            color,
          });
          if (finalKind === 'income' && linkForecastId && linkOccurrenceDate) {
            await linkLedgerToIncomeForecast({
              ledgerTransactionId: row.id,
              forecastId: linkForecastId,
              occurrenceDate: linkOccurrenceDate,
            });
          }
        }
      } else if (entryType === 'transfer') {
        if (!fromAccountId || !toAccountId || !amount.trim()) return;
        await createTransfer({
          date,
          amountCents: parseEurToCents(amount),
          fromAccountId,
          toAccountId,
          title: title.trim() || t('accounts.defaultTransferTitle'),
          notes: description.trim() ? description : null,
        });
      } else if (entryType === 'income_forecast') {
        if (!forecastName.trim() || !amount.trim()) return;
        await createIncomeForecast({
          name: forecastName.trim(),
          amountCents: parseEurToCents(amount),
          cadence,
          firstChargeDate,
          dueRule: dueRule as IncomeForecastDueRule,
          dayOfMonth: dueRule === 'calendar_day' ? Number(dayOfMonth || '1') : null,
          endChargeDate: hasEndDate ? endChargeDate : null,
          accountId: incomeForecastAccountId || mainAccountId,
        });
      } else if (entryType === 'expense_forecast') {
        if (!forecastName.trim() || !amount.trim()) return;
        await createFixedCost({
          name: forecastName.trim(),
          amountCents: parseEurToCents(amount),
          cadence: 'once',
          firstChargeDate,
          active: true,
          notes: null,
          dueRule: 'calendar_day',
          dayOfMonth: Number(firstChargeDate.slice(8, 10) || '1'),
          endChargeDate: firstChargeDate,
          accountId: expenseAccountId || mainAccountId,
        });
      } else if (isLedgerCreateType(entryType)) {
        const ledgerAccount = fromAccountId || accountId || mainAccountId;
        if (!amount.trim() || !ledgerAccount) return;
        await createLedgerTransaction({
          date,
          amountCents: amountCentsForKind(entryType, parseEurToCents(amount)),
          accountId: ledgerAccount,
          kind: entryType,
          title: title.trim() ? title : kindLabel(entryType, t),
          notes: description.trim() ? description : null,
          ...ledgerCategoryIds(canAssignCategory(entryType) ? expenseCategory : { kind: 'none', id: null }),
          icon,
          color,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const saveDisabled = (() => {
    if (isEdit) {
      if (entryType === 'transfer') {
        return !fromAccountId || !toAccountId || !amount.trim() || fromAccountId === toAccountId;
      }
      return !amount.trim();
    }
    if (entryType === 'transfer') return !fromAccountId || !toAccountId || !amount.trim() || fromAccountId === toAccountId;
    if (entryType === 'income_forecast' || entryType === 'expense_forecast') {
      return !forecastName.trim() || !amount.trim();
    }
    return !(fromAccountId || accountId || mainAccountId) || !amount.trim();
  })();

  return (
    <Modal
      open={open}
      wide
      title={isEdit ? t('transactions.editEntry') : t('transactions.newEntry')}
      onClose={onClose}
    >
      <div className="fh-form">
        {!isEdit ? (
          <label>
            {t('common.type')}
            <select value={entryType} onChange={(e) => onEntryTypeChange(e.target.value as CreateEntryType)}>
              <option value="expense">{t('transactions.kinds.expense')}</option>
              <option value="income">{t('transactions.kinds.income')}</option>
              <option value="adjustment">{t('transactions.kinds.adjustment')}</option>
              <option value="income_forecast">{t('transactions.kinds.income_forecast')}</option>
              <option value="expense_forecast">{t('transactions.kinds.expense_forecast')}</option>
              <option value="transfer">{t('transactions.kinds.transfer')}</option>
            </select>
          </label>
        ) : lockedKind ? (
          <label>
            {t('common.type')}
            <div className="fh-form-hint" style={{ marginTop: 0 }}>
              {kindLabel(row!.kind, t)}
            </div>
          </label>
        ) : (
          <label>
            {t('common.type')}
            <select
              value={entryType}
              onChange={(e) => onEntryTypeChange(e.target.value as EditEntryType)}
            >
              <option value="expense">{t('transactions.kinds.expense')}</option>
              <option value="income">{t('transactions.kinds.income')}</option>
              <option value="adjustment">{t('transactions.kinds.adjustment')}</option>
              <option value="transfer">{t('transactions.kinds.transfer')}</option>
            </select>
          </label>
        )}

        {showTransferFields ? (
          <>
            <p className="fh-form-hint">{t('accounts.transferDesc')}</p>
            <div className="fh-form-row">
              <label>
                {t('common.from')}
                <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                  <option value="">{t('common.none')}</option>
                  {allAccountOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('common.to')}
                <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  <option value="">{t('common.none')}</option>
                  {allAccountOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="fh-form-row">
              <label>
                {t('common.date')}
                <DateInput value={date} onChange={setDate} />
              </label>
              <label>
                {t('common.amount')} (EUR)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100,00" />
              </label>
            </div>
            <label>
              {t('common.title')}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('accounts.defaultTransferTitle')}
              />
              <OptionalDescriptionInput value={description} onChange={setDescription} />
            </label>
          </>
        ) : null}

        {showIncomeForecastFields ? (
          <>
            <p className="fh-form-hint">{t('incomeForecasts.formHint')}</p>
            <div className="fh-form-row">
              <label>
                {t('common.name')}
                <input
                  value={forecastName}
                  onChange={(e) => setForecastName(e.target.value)}
                  placeholder={t('incomeForecasts.namePlaceholder')}
                />
              </label>
              <label>
                {t('common.amount')} (EUR)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500,00" />
              </label>
            </div>
            <label>
              {t('transactions.accountLabel')}
              <select
                value={incomeForecastAccountId || mainAccountId}
                onChange={(e) => setIncomeForecastAccountId(e.target.value)}
              >
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="fh-form-row">
              <label>
                {t('common.rhythm')}
                <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                  {INCOME_CADENCE.map((key) => (
                    <option key={key} value={key}>
                      {t(`cadence.${key}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('common.firstPayment')}
                <DateInput value={firstChargeDate} onChange={onFirstPaymentChange} />
              </label>
            </div>
            <div className="fh-form-row">
              <label>
                {t('common.due')}
                <select
                  value={dueRule}
                  onChange={(e) => {
                    const rule = e.target.value as IncomeForecastDueRule;
                    setDueRule(rule);
                    if (rule !== 'calendar_day') setDayOfMonth('');
                  }}
                >
                  {INCOME_DUE_RULES.map((key) => (
                    <option key={key} value={key}>
                      {t(`dueRule.${key}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('common.dayOfMonth')}
                <input
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  disabled={dayOfMonthDisabled}
                  inputMode="numeric"
                  placeholder={t('common.day')}
                />
              </label>
            </div>
            <div className="fh-form-block">
              <Checkbox checked={hasEndDate} onChange={setHasEndDate}>
                {t('common.endDateOptional')}
              </Checkbox>
              {hasEndDate ? (
                <DateInput value={endChargeDate} onChange={setEndChargeDate} />
              ) : (
                <div style={{ padding: '8px 0', color: ui.colors.textMuted, fontSize: 13 }}>{t('common.unlimited')}</div>
              )}
            </div>
          </>
        ) : null}

        {showExpenseForecastFields ? (
          <>
            <p className="fh-form-hint">{t('fixedCosts.formHint')}</p>
            <div className="fh-form-row">
              <label>
                {t('common.name')}
                <input
                  value={forecastName}
                  onChange={(e) => setForecastName(e.target.value)}
                  placeholder={t('fixedCosts.namePlaceholder')}
                />
              </label>
              <label>
                {t('common.amount')} (EUR)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="850,00" />
              </label>
            </div>
            <label>
              {t('transactions.accountLabel')}
              <select value={expenseAccountId || mainAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="fh-form-row">
              <label>
                {t('common.rhythm')}
                <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                  {INCOME_CADENCE.map((key) => (
                    <option key={key} value={key}>
                      {t(`cadence.${key}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('common.firstCharge')}
                <DateInput value={firstChargeDate} onChange={onFirstPaymentChange} />
              </label>
            </div>
            <div className="fh-form-row">
              <label>
                {t('common.due')}
                <select
                  value={dueRule}
                  onChange={(e) => {
                    const rule = e.target.value as FixedCostDueRule;
                    setDueRule(rule);
                    if (rule !== 'calendar_day') setDayOfMonth('');
                  }}
                >
                  {EXPENSE_DUE_RULES.map((key) => (
                    <option key={key} value={key}>
                      {t(`dueRule.${key}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('common.dayOfMonth')}
                <input
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  disabled={dueRule !== 'calendar_day'}
                  inputMode="numeric"
                  placeholder={t('common.day')}
                />
              </label>
            </div>
            <div className="fh-form-block">
              <Checkbox checked={hasEndDate} onChange={setHasEndDate}>
                {t('common.endDateOptional')}
              </Checkbox>
              {hasEndDate ? (
                <DateInput value={endChargeDate} onChange={setEndChargeDate} />
              ) : (
                <div style={{ padding: '8px 0', color: ui.colors.textMuted, fontSize: 13 }}>{t('common.unlimited')}</div>
              )}
            </div>
          </>
        ) : null}

        {showLedgerFields ? (
          <>
            <label>
              {t('transactions.accountLabel')}
              <select value={fromAccountId || accountId || mainAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('transactions.titleField')}
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('transactions.titlePlaceholder')} />
              <OptionalDescriptionInput value={description} onChange={setDescription} />
            </label>
            <div className="fh-form-row">
              <label>
                {t('common.date')}
                <DateInput value={date} onChange={setDate} />
              </label>
              <label>
                {entryType === 'adjustment' ? t('transactions.adjustmentAmount') : t('transactions.amountLabel')}
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,34" />
              </label>
            </div>
            {canAssignCategory(entryType as string) ? (
              <label>
                {t('common.category')}
                <ExpenseCategoryField
                  variableCosts={variableCosts}
                  fixedCosts={fixedCosts}
                  value={expenseCategory}
                  onChange={setExpenseCategory}
                />
              </label>
            ) : null}
            {showIncomeForecastLink ? (
              <>
                <p className="fh-form-hint">{t('transactions.linkIncomeForecastHint')}</p>
                <div className="fh-form-row">
                  <label>
                    {t('transactions.linkIncomeForecast')}
                    <select
                      value={linkForecastId}
                      onChange={(e) => {
                        setLinkForecastId(e.target.value);
                        setLinkOccurrenceDate('');
                      }}
                    >
                      <option value="">{t('transactions.linkIncomeForecastNone')}</option>
                      {editableIncomeForecasts.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('common.date')}
                    <select
                      value={linkOccurrenceDate}
                      onChange={(e) => setLinkOccurrenceDate(e.target.value as IsoDate)}
                      disabled={!linkForecastId}
                    >
                      <option value="">{t('common.none')}</option>
                      {linkOccurrences.map((d) => (
                        <option key={d} value={d}>
                          {formatDisplayDate(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : null}
            <label>
              {t('common.icon')}
              <IconPicker value={icon} onChange={setIcon} />
            </label>
            <label>
              {t('common.color')}
              <ColorPicker value={color} onChange={setColor} />
            </label>
          </>
        ) : null}

        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={saveDisabled}>
              {entryType === 'transfer' ? t('common.book') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { kindLabel as transactionKindLabel, formatDisplayDate };
