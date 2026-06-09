import { useEffect, useMemo, useState } from 'react';
import type { Account, Cadence, IncomeForecast, IncomeForecastDueRule, IsoDate } from '../../lib/types';
import { AddEntryButton } from '../common/AddEntryButton';
import { Checkbox } from '../common/Checkbox';
import { Modal } from '../common/Modal';
import { AmountTable } from '../data/AmountTable';
import { SortableTh, sortByState, type SortState } from '../data/tableSort';
import { TdAmount } from '../data/AmountCells';
import { DetailLink } from '../DetailLink';
import { formatDisplayDate, isoToday } from '../../lib/date';
import { formatIncomeEurFromCents, parseEurToCents } from '../../lib/money';
import {
  createIncomeForecast,
  deleteIncomeForecast,
  listAccounts,
  listIncomeForecasts,
  previewIncomeForecast,
  updateIncomeForecast,
} from '../../tauri/api';
import { useUi } from '../../lib/ui';
import { ListPanel } from '../layout/ListPanel';
import { DateInput } from '../DateInput';
import { EditIconButton } from '../EditIconButton';
import { TrashIconButton } from '../TrashIconButton';
import { useLocale } from '../../i18n/LocaleProvider';

const CADENCE_KEYS: Cadence[] = ['once', 'yearly', 'monthly', 'weekly', 'biweekly'];
const DUE_RULE_KEYS: IncomeForecastDueRule[] = ['calendar_day', 'first_business_day', 'last_business_day'];

const DATA_COLS = 'minmax(160px, 1.5fr) 100px 120px 130px minmax(200px, 2fr) 120px 72px';

function dayFromIso(iso: string): string {
  return iso.split('-')[2]?.replace(/^0/, '') ?? '1';
}

function dueRuleLabel(
  rule: IncomeForecastDueRule,
  dayOfMonth: number | null,
  t: (key: string) => string,
): string {
  if (rule === 'calendar_day' && dayOfMonth) {
    return `${t(`dueRule.${rule}`)} (${dayOfMonth}.)`;
  }
  return t(`dueRule.${rule}`);
}

type ForecastFormState = {
  name: string;
  amount: string;
  cadence: Cadence;
  firstChargeDate: IsoDate;
  dueRule: IncomeForecastDueRule;
  dayOfMonth: string;
  hasEndDate: boolean;
  endChargeDate: IsoDate | '';
  accountId: string;
};

function emptyForm(mainAccountId: string): ForecastFormState {
  const today = isoToday();
  return {
    name: '',
    amount: '',
    cadence: 'monthly',
    firstChargeDate: today,
    dueRule: 'calendar_day',
    dayOfMonth: dayFromIso(today),
    hasEndDate: false,
    endChargeDate: '',
    accountId: mainAccountId,
  };
}

function formFromRow(row: IncomeForecast): ForecastFormState {
  return {
    name: row.name,
    amount: (row.amountCents / 100).toFixed(2).replace('.', ','),
    cadence: row.cadence,
    firstChargeDate: row.firstChargeDate,
    dueRule: row.dueRule,
    dayOfMonth: String(row.dayOfMonth ?? 1),
    hasEndDate: !!row.endChargeDate,
    endChargeDate: row.endChargeDate ?? '',
    accountId: row.accountId,
  };
}

type IncomeForecastsPanelProps = {
  onError?: (message: string | null) => void;
};

export function IncomeForecastsPanel({ onError }: IncomeForecastsPanelProps) {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<IncomeForecast[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, IsoDate[]>>({});

  const ledgerAccounts = useMemo(() => accounts.filter((a) => a.balanceSource === 'ledger'), [accounts]);
  const mainAccountId = useMemo(
    () => ledgerAccounts.find((a) => a.isMain)?.id ?? ledgerAccounts[0]?.id ?? '',
    [ledgerAccounts],
  );
  type ForecastSortKey = 'name' | 'cadence' | 'amount' | 'firstCharge' | 'due' | 'end';
  const [sort, setSort] = useState<SortState<ForecastSortKey>>(null);
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        name: (r) => r.name,
        cadence: (r) => r.cadence,
        amount: (r) => r.amountCents,
        firstCharge: (r) => r.firstChargeDate,
        due: (r) => dueRuleLabel(r.dueRule, r.dayOfMonth, t),
        end: (r) => r.endChargeDate ?? '',
      }),
    [rows, sort, t],
  );

  async function refresh() {
    const [data, accountRows] = await Promise.all([listIncomeForecasts(), listAccounts()]);
    setRows(data);
    setAccounts(accountRows);
    const entries = await Promise.all(
      data.map(async (row) => {
        try {
          const dates = await previewIncomeForecast(row.id);
          return [row.id, dates] as const;
        } catch {
          return [row.id, []] as const;
        }
      }),
    );
    setPreview(Object.fromEntries(entries));
  }

  useEffect(() => {
    refresh()
      .then(() => onError?.(null))
      .catch((e) => onError?.(e instanceof Error ? e.message : String(e)));
  }, [onError]);

  function openCreate() {
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(row: IncomeForecast) {
    setEditingId(row.id);
    setModalOpen(true);
  }

  async function onDelete(id: string) {
    onError?.(null);
    await deleteIncomeForecast(id);
    await refresh();
  }

  return (
    <>
      <div className="fh-page-header-actions" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
        <AddEntryButton label={t('incomeForecasts.newEntry')} onClick={openCreate} />
      </div>

      <ListPanel title={t('common.entries')} hint={t('incomeForecasts.listHint')}>
        <AmountTable>
          <div style={{ ...ui.tableHead, gridTemplateColumns: DATA_COLS }}>
            <SortableTh label={t('common.name')} sortKey="name" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('common.rhythm')} sortKey="cadence" sort={sort} onSort={setSort} />
            <SortableTh
              label={t('common.amount')}
              sortKey="amount"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="right"
            />
            <SortableTh label={t('common.firstPayment')} sortKey="firstCharge" sort={sort} onSort={setSort} />
            <SortableTh label={t('common.due')} sortKey="due" sort={sort} onSort={setSort} />
            <SortableTh label={t('common.end')} sortKey="end" sort={sort} onSort={setSort} />
            <div />
          </div>
          {rows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.noForecasts')}</div>
          ) : (
            sortedRows.map((r) => (
              <div key={r.id}>
                <div style={{ ...ui.tableRow, gridTemplateColumns: DATA_COLS }}>
                  <div style={ui.tdName}>
                    <DetailLink to={`/transaktionen/prognose/${r.id}`}>{r.name}</DetailLink>
                  </div>
                  <div style={ui.tdCenter}>{t(`cadence.${r.cadence}`)}</div>
                  <TdAmount col="amount" amountCents={r.amountCents}>
                    {formatIncomeEurFromCents(r.amountCents)}
                  </TdAmount>
                  <div style={ui.tdMono}>{formatDisplayDate(r.firstChargeDate)}</div>
                  <div style={ui.tdCenter}>{dueRuleLabel(r.dueRule, r.dayOfMonth, t)}</div>
                  <div style={{ ...ui.tdMono, color: ui.colors.textMuted }}>
                    {r.endChargeDate ? formatDisplayDate(r.endChargeDate) : t('common.none')}
                  </div>
                  <div style={ui.tdActions}>
                    <EditIconButton label={t('common.edit')} onClick={() => openEdit(r)} />
                    <TrashIconButton label={t('common.delete')} onClick={() => onDelete(r.id)} />
                  </div>
                </div>
                <div style={ui.rowPreview}>
                  {t('common.nextDates')}:{' '}
                  {(preview[r.id]?.length ?? 0) > 0
                    ? preview[r.id].map((d) => formatDisplayDate(d)).join(', ')
                    : t('common.none')}
                </div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <IncomeForecastModal
        open={modalOpen}
        forecastId={editingId}
        rows={rows}
        accounts={ledgerAccounts}
        mainAccountId={mainAccountId}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await refresh();
        }}
        onError={onError}
      />
    </>
  );
}

function IncomeForecastModal({
  open,
  forecastId,
  rows,
  accounts,
  mainAccountId,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  forecastId: string | null;
  rows: IncomeForecast[];
  accounts: Account[];
  mainAccountId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError?: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const ui = useUi();
  const existing = forecastId ? rows.find((r) => r.id === forecastId) : undefined;
  const [form, setForm] = useState<ForecastFormState>(() => emptyForm(mainAccountId));

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setForm(formFromRow(existing));
    } else {
      setForm(emptyForm(mainAccountId));
    }
  }, [open, existing, mainAccountId]);

  function patch(partial: Partial<ForecastFormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function onFirstChargeDateChange(value: IsoDate) {
    patch({
      firstChargeDate: value,
      dayOfMonth: form.dueRule === 'calendar_day' ? dayFromIso(value) : form.dayOfMonth,
    });
  }

  async function save() {
    if (!form.name.trim() || !form.amount.trim()) return;
    onError?.(null);
    try {
      const payload = {
        name: form.name.trim(),
        amountCents: parseEurToCents(form.amount),
        cadence: form.cadence,
        firstChargeDate: form.firstChargeDate,
        dueRule: form.dueRule,
        dayOfMonth: form.dueRule === 'calendar_day' ? Number(form.dayOfMonth || '1') : null,
        endChargeDate: form.hasEndDate && form.endChargeDate ? form.endChargeDate : null,
        accountId: form.accountId || mainAccountId,
      };
      if (forecastId && existing) {
        await updateIncomeForecast({
          id: forecastId,
          ...payload,
          active: existing.active,
        });
      } else {
        await createIncomeForecast(payload);
      }
      await onSaved();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  const dayOfMonthDisabled =
    form.dueRule !== 'calendar_day' || form.cadence === 'weekly' || form.cadence === 'biweekly';

  return (
    <Modal
      open={open}
      wide
      title={forecastId ? t('incomeForecasts.editEntry') : t('incomeForecasts.newEntry')}
      onClose={onClose}
    >
      <div className="fh-form">
        <p className="fh-form-hint">{t('incomeForecasts.formHint')}</p>
        <div className="fh-form-row">
          <label>
            {t('common.name')}
            <input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('incomeForecasts.namePlaceholder')}
            />
          </label>
          <label>
            {t('common.amount')} (EUR)
            <input value={form.amount} onChange={(e) => patch({ amount: e.target.value })} placeholder="2500,00" />
          </label>
        </div>
        <label>
          {t('transactions.accountLabel')}
          <select value={form.accountId || mainAccountId} onChange={(e) => patch({ accountId: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="fh-form-row">
          <label>
            {t('common.rhythm')}
            <select value={form.cadence} onChange={(e) => patch({ cadence: e.target.value as Cadence })}>
              {CADENCE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`cadence.${key}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('common.firstPayment')}
            <DateInput value={form.firstChargeDate} onChange={onFirstChargeDateChange} />
          </label>
        </div>
        <div className="fh-form-row">
          <label>
            {t('common.due')}
            <select
              value={form.dueRule}
              onChange={(e) => {
                const rule = e.target.value as IncomeForecastDueRule;
                patch({ dueRule: rule, dayOfMonth: rule !== 'calendar_day' ? '' : form.dayOfMonth });
              }}
            >
              {DUE_RULE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`dueRule.${key}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('common.dayOfMonth')}
            <input
              value={form.dayOfMonth}
              onChange={(e) => patch({ dayOfMonth: e.target.value })}
              disabled={dayOfMonthDisabled}
              inputMode="numeric"
              placeholder={t('common.day')}
            />
          </label>
        </div>
        <div className="fh-form-block">
          <Checkbox checked={form.hasEndDate} onChange={(checked) => patch({ hasEndDate: checked })}>
            {t('common.endDateOptional')}
          </Checkbox>
          {form.hasEndDate ? (
            <>
              <span style={{ display: 'block', marginTop: 8, marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
                {t('incomeForecasts.lastPayment')}
              </span>
              <DateInput
                value={(form.endChargeDate || form.firstChargeDate) as IsoDate}
                onChange={(d) => patch({ endChargeDate: d })}
              />
            </>
          ) : (
            <div style={{ padding: '8px 0', color: ui.colors.textMuted, fontSize: 13 }}>{t('common.unlimited')}</div>
          )}
        </div>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button
              type="button"
              className="fh-btn primary"
              onClick={save}
              disabled={!form.name.trim() || !form.amount.trim()}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
