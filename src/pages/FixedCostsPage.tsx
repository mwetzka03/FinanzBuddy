import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Account, Cadence, FixedCost, FixedCostDueRule, IsoDate, LedgerTransaction } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { ColorPicker, EntityIconBadge, IconPicker } from '../components/common/AppIcon';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { formatDisplayDate, isoToday } from '../lib/date';
import { dueRuleShort } from '../lib/transactionList';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, parseEurToCents } from '../lib/money';
import {
  createFixedCost,
  deleteFixedCost,
  listAccounts,
  listFixedCosts,
  listLedgerTransactions,
  previewFixedCost,
  updateFixedCost,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { DateInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { FixedCostHistoryModal } from '../components/transactions/FixedCostHistoryModal';
import { TrashIconButton } from '../components/TrashIconButton';

const TABLE_COLS = 'minmax(140px, 1.5fr) 110px 120px 130px minmax(150px, 1.5fr) 110px minmax(120px, 1fr) 72px';

function cadenceLabel(c: Cadence, t: (key: string) => string): string {
  return t(`cadence.${c}`);
}

function dayFromIso(iso: string): string {
  return iso.split('-')[2]?.replace(/^0/, '') ?? '1';
}

function defaultMainAccountId(accounts: Account[]): string {
  return accounts.find((a) => a.isMain)?.id ?? accounts[0]?.id ?? '';
}

type FixedCostFormState = {
  name: string;
  amount: string;
  cadence: Cadence;
  firstChargeDate: IsoDate;
  dueRule: FixedCostDueRule;
  dayOfMonth: string;
  hasEndDate: boolean;
  endChargeDate: IsoDate | '';
  accountId: string;
  icon: string;
  color: string;
};

function emptyForm(mainAccountId: string): FixedCostFormState {
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
    icon: 'calendar',
    color: '#6366f1',
  };
}

function formFromRow(r: FixedCost): FixedCostFormState {
  return {
    name: r.name,
    amount: (r.amountCents / 100).toFixed(2).replace('.', ','),
    cadence: r.cadence,
    firstChargeDate: r.firstChargeDate,
    dueRule: r.dueRule,
    dayOfMonth: String(r.dayOfMonth ?? 1),
    hasEndDate: !!r.endChargeDate,
    endChargeDate: r.endChargeDate ?? '',
    accountId: r.accountId,
    icon: r.icon,
    color: r.color,
  };
}

export function FixedCostsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const location = useLocation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rows, setRows] = useState<FixedCost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, IsoDate[]>>({});
  const [ledgerRows, setLedgerRows] = useState<LedgerTransaction[]>([]);
  const [historyFixedCost, setHistoryFixedCost] = useState<FixedCost | null>(null);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const mainAccountId = useMemo(() => defaultMainAccountId(accounts), [accounts]);
  type FixedCostSortKey = 'name' | 'cadence' | 'amount' | 'firstCharge' | 'due' | 'end' | 'account';
  const [sort, setSort] = useState<SortState<FixedCostSortKey>>(null);
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        name: (r) => r.name,
        cadence: (r) => r.cadence,
        amount: (r) => r.amountCents,
        firstCharge: (r) => r.firstChargeDate,
        due: (r) => dueRuleShort(r.dueRule, r.dayOfMonth, t),
        end: (r) => r.endChargeDate ?? '',
        account: (r) => accountMap.get(r.accountId) ?? '',
      }),
    [rows, sort, accountMap, t],
  );

  async function refresh() {
    const [accountRows, data, ledger] = await Promise.all([
      listAccounts(),
      listFixedCosts(),
      listLedgerTransactions({}),
    ]);
    setAccounts(accountRows);
    setRows(data);
    setLedgerRows(ledger);
    const entries = await Promise.all(
      data.map(async (row) => {
        try {
          const dates = await previewFixedCost(row.id);
          return [row.id, dates] as const;
        } catch {
          return [row.id, []] as const;
        }
      }),
    );
    setPreview(Object.fromEntries(entries));
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const editId = (location.state as { editId?: string } | null)?.editId;
    if (!editId) return;
    setEditingId(editId);
    setModalOpen(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  function openCreate() {
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(r: FixedCost) {
    setEditingId(r.id);
    setModalOpen(true);
  }

  async function onDelete(id: string) {
    setError(null);
    await deleteFixedCost(id);
    await refresh();
  }

  return (
    <PageShell
      title={t('fixedCosts.title')}
      intro={t('fixedCosts.intro')}
      error={error}
      headerActions={<AddEntryButton label={t('fixedCosts.newEntry')} onClick={openCreate} />}
    >
      <ListPanel hint={t('fixedCosts.listHint')}>
        <AmountTable>
          <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
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
            <SortableTh label={t('common.firstCharge')} sortKey="firstCharge" sort={sort} onSort={setSort} />
            <SortableTh label={t('common.due')} sortKey="due" sort={sort} onSort={setSort} />
            <SortableTh label={t('common.end')} sortKey="end" sort={sort} onSort={setSort} />
            <SortableTh label={t('transactions.accountLabel')} sortKey="account" sort={sort} onSort={setSort} />
            <div />
          </div>
          {rows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.none')}</div>
          ) : (
            sortedRows.map((r) => (
              <div key={r.id}>
                <div style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                <div style={ui.cellStack}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <EntityIconBadge icon={r.icon} color={r.color} size={20} />
                    <button
                      type="button"
                      className="fh-link-button"
                      style={ui.nameLink}
                      onClick={() => setHistoryFixedCost(r)}
                    >
                      {r.name}
                    </button>
                  </div>
                </div>
                  <div style={ui.tdCenter}>{cadenceLabel(r.cadence, t)}</div>
                  <TdAmount col="amount" amountCents={-r.amountCents}>
                    {formatExpenseEurFromCents(r.amountCents)}
                  </TdAmount>
                  <div style={ui.tdMono}>{formatDisplayDate(r.firstChargeDate)}</div>
                  <div style={ui.tdCenter}>{dueRuleShort(r.dueRule, r.dayOfMonth, t)}</div>
                  <div style={ui.tdMono}>{r.endChargeDate ? formatDisplayDate(r.endChargeDate) : '—'}</div>
                  <div style={{ ...ui.tdCenter, fontSize: 13 }}>{accountMap.get(r.accountId) ?? '—'}</div>
                  <div style={ui.tdActions}>
                    <EditIconButton label={t('common.edit')} onClick={() => openEdit(r)} />
                    <TrashIconButton label={t('common.delete')} onClick={() => onDelete(r.id)} />
                  </div>
                </div>
                <div style={ui.rowPreview}>
                  {t('common.nextCharges')}:{' '}
                  {(preview[r.id]?.length ?? 0) > 0 ? preview[r.id].map(formatDisplayDate).join(', ') : '—'}
                </div>
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

      <FixedCostModal
        open={modalOpen}
        costId={editingId}
        rows={rows}
        accounts={accounts}
        mainAccountId={mainAccountId}
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

function FixedCostModal({
  open,
  costId,
  rows,
  accounts,
  mainAccountId,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  costId: string | null;
  rows: FixedCost[];
  accounts: Account[];
  mainAccountId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const ui = useUi();
  const existing = costId ? rows.find((r) => r.id === costId) : undefined;
  const [form, setForm] = useState<FixedCostFormState>(() => emptyForm(mainAccountId));

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setForm(formFromRow(existing));
    } else {
      setForm(emptyForm(mainAccountId));
    }
  }, [open, existing, mainAccountId]);

  function patch(partial: Partial<FixedCostFormState>) {
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
    onError(null);
    try {
      const payload = {
        name: form.name,
        amountCents: parseEurToCents(form.amount),
        cadence: form.cadence,
        firstChargeDate: form.firstChargeDate,
        active: true,
        notes: null as string | null,
        dueRule: form.dueRule,
        dayOfMonth: form.dueRule === 'calendar_day' ? Number(form.dayOfMonth || '1') : null,
        endChargeDate: form.hasEndDate && form.endChargeDate ? form.endChargeDate : null,
        accountId: form.accountId || mainAccountId,
        icon: form.icon,
        color: form.color,
      };
      if (costId) {
        await updateFixedCost({ id: costId, ...payload });
      } else {
        await createFixedCost(payload);
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} wide title={costId ? t('fixedCosts.editEntry') : t('fixedCosts.newEntry')} onClose={onClose}>
      <div className="fh-form">
        <div className="fh-form-row">
          <label>
            {t('common.name')}
            <input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('fixedCosts.namePlaceholder')} />
          </label>
          <label>
            {t('common.amount')} (EUR)
            <input value={form.amount} onChange={(e) => patch({ amount: e.target.value })} placeholder="850,00" />
          </label>
        </div>
        <label>
          {t('common.icon')}
          <IconPicker value={form.icon} onChange={(icon) => patch({ icon })} />
        </label>
        <label>
          {t('common.color')}
          <ColorPicker value={form.color} onChange={(color) => patch({ color })} />
        </label>
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
              {(['once', 'yearly', 'monthly', 'weekly', 'biweekly'] as Cadence[]).map((c) => (
                <option key={c} value={c}>
                  {cadenceLabel(c, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('common.firstCharge')}
            <DateInput value={form.firstChargeDate} onChange={onFirstChargeDateChange} />
          </label>
        </div>
        <div className="fh-form-row">
          <label>
            {t('common.due')}
            <select
              value={form.dueRule}
              onChange={(e) => {
                const rule = e.target.value as FixedCostDueRule;
                patch({ dueRule: rule, dayOfMonth: rule !== 'calendar_day' ? '' : form.dayOfMonth });
              }}
            >
              <option value="calendar_day">{t('dueRule.calendar_day')}</option>
              <option value="first_business_day">{t('dueRule.first_business_day')}</option>
              <option value="last_business_day">{t('dueRule.last_business_day')}</option>
            </select>
          </label>
          <label>
            {t('common.dayOfMonth')}
            <input
              value={form.dayOfMonth}
              onChange={(e) => patch({ dayOfMonth: e.target.value })}
              disabled={form.dueRule !== 'calendar_day'}
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
            <DateInput value={(form.endChargeDate || isoToday()) as IsoDate} onChange={(d) => patch({ endChargeDate: d })} />
          ) : (
            <div style={{ padding: '8px 0', color: ui.colors.textMuted, fontSize: 13 }}>{t('common.unlimited')}</div>
          )}
        </div>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!form.name.trim() || !form.amount.trim()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
