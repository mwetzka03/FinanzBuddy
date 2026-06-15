import { useEffect, useMemo, useState } from 'react';
import type { Account, BudgetPool, BudgetPoolPeriodMode, DashboardPeriodNavItem } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { ColorPicker, EntityIconBadge, IconPicker } from '../components/common/AppIcon';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, formatBalanceEurFromCents, parseEurToCents } from '../lib/money';
import {
  createBudgetPool,
  deleteBudgetPool,
  listAccounts,
  listBudgetPools,
  listDashboardPeriods,
  updateBudgetPool,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';
import { BudgetPoolHistoryModal } from '../components/budgetPools/BudgetPoolHistoryModal';

const TABLE_COLS = '48px minmax(160px, 1.4fr) 120px 120px 120px 72px';

export function BudgetPoolsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<BudgetPool[]>([]);
  type SortKey = 'name' | 'planned' | 'actual' | 'remaining';
  const [sort, setSort] = useState<SortState<SortKey>>(null);
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        name: (r) => r.name,
        planned: (r) => r.plannedCents,
        actual: (r) => r.actualCents,
        remaining: (r) => r.remainingCents,
      }),
    [rows, sort],
  );
  const pagination = useTablePagination(sortedRows);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyPool, setHistoryPool] = useState<BudgetPool | null>(null);

  async function refresh() {
    setRows(await listBudgetPools());
    listAccounts().then(setAccounts).catch(() => undefined);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function openCreate() {
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(row: BudgetPool) {
    setEditingId(row.id);
    setModalOpen(true);
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await deleteBudgetPool(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <PageShell
      title={t('budgetPools.title')}
      intro={t('budgetPools.intro')}
      error={error}
      onErrorDismiss={() => setError(null)}
      headerActions={<AddEntryButton label={t('budgetPools.newEntry')} onClick={openCreate} />}
    >
      <ListPanel hint={t('budgetPools.listHint')}>
        <AmountTable>
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
            <div />
            <SortableTh label={t('common.name')} sortKey="name" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh
              label={t('budgetPools.planned')}
              sortKey="planned"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="forecast"
            />
            <SortableTh
              label={t('budgetPools.actual')}
              sortKey="actual"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="actual"
            />
            <SortableTh
              label={t('budgetPools.remaining')}
              sortKey="remaining"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="remaining"
            />
            <div />
          </div>
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
          {rows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.none')}</div>
          ) : (
            pagination.pageItems.map((r) => (
              <div key={r.id} className="fh-table-row" style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                <EntityIconBadge icon={r.icon} color={r.color} size={20} />
                <div style={ui.cellStack}>
                  <button
                    type="button"
                    className="fh-link-button"
                    style={{ fontWeight: 600, textAlign: 'left', padding: 0 }}
                    onClick={() => setHistoryPool(r)}
                  >
                    {r.name}
                  </button>
                  <div style={ui.cellSub}>
                    {t(`budgetPools.periodMode.${r.periodMode}`)}
                    {r.scalable ? ` · ${t('budgetPools.scalableBadge')}` : ''}
                  </div>
                  {r.notes ? <div style={ui.cellSub}>{r.notes}</div> : null}
                </div>
                <TdAmount col="forecast" amountCents={-r.plannedCents}>
                  {formatExpenseEurFromCents(r.plannedCents)}
                </TdAmount>
                <TdAmount col="actual" amountCents={-r.actualCents}>
                  {formatExpenseEurFromCents(r.actualCents)}
                </TdAmount>
                <TdAmount col="remaining" amountCents={r.remainingCents}>
                  {formatBalanceEurFromCents(r.remainingCents)}
                </TdAmount>
                <div style={ui.tdActions}>
                  <EditIconButton label={t('common.edit')} onClick={() => openEdit(r)} />
                  <TrashIconButton label={t('common.delete')} onClick={() => void onDelete(r.id)} />
                </div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <BudgetPoolHistoryModal
        open={historyPool != null}
        pool={historyPool}
        onClose={() => setHistoryPool(null)}
      />

      <BudgetPoolModal
        open={modalOpen}
        poolId={editingId}
        rows={rows}
        accounts={accounts}
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

function BudgetPoolModal({
  open,
  poolId,
  rows,
  accounts,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  poolId: string | null;
  rows: BudgetPool[];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const existing = poolId ? rows.find((r) => r.id === poolId) : undefined;
  const mainAccountId = accounts.find((a) => a.isMain)?.id ?? accounts[0]?.id ?? '';

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [periodMode, setPeriodMode] = useState<BudgetPoolPeriodMode>('salary_period');
  const [notes, setNotes] = useState('');
  const [icon, setIcon] = useState('piggy-bank');
  const [color, setColor] = useState('#0ea5e9');
  const [accountId, setAccountId] = useState('');
  const [scalable, setScalable] = useState(false);
  const [startPeriodKey, setStartPeriodKey] = useState('');
  const [salaryPeriods, setSalaryPeriods] = useState<DashboardPeriodNavItem[]>([]);

  useEffect(() => {
    if (!open) return;
    listDashboardPeriods()
      .then(setSalaryPeriods)
      .catch(() => setSalaryPeriods([]));
  }, [open]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: string[] = [];
    for (let year = currentYear - 10; year <= currentYear + 1; year += 1) {
      years.push(String(year));
    }
    return years.reverse();
  }, []);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setAmount(existing ? (existing.amountCents / 100).toFixed(2).replace('.', ',') : '');
    setPeriodMode(existing?.periodMode ?? 'salary_period');
    setNotes(existing?.notes ?? '');
    setIcon(existing?.icon ?? 'piggy-bank');
    setColor(existing?.color ?? '#0ea5e9');
    setAccountId(existing?.accountId ?? mainAccountId);
    setScalable(existing?.scalable ?? false);
    setStartPeriodKey(existing?.scalableStartPeriodKey ?? '');
  }, [open, existing, mainAccountId]);

  useEffect(() => {
    if (!open || !scalable || startPeriodKey) return;
    if (periodMode === 'yearly') {
      setStartPeriodKey(String(new Date().getFullYear()));
      return;
    }
    const current = salaryPeriods.find((period) => period.isCurrent);
    if (current) {
      setStartPeriodKey(`${current.periodStart}:${current.periodEnd}`);
    }
  }, [open, scalable, startPeriodKey, periodMode, salaryPeriods]);

  const canSave =
    name.trim().length > 0 &&
    amount.trim().length > 0 &&
    (!scalable || startPeriodKey.trim().length > 0);

  async function save() {
    if (!canSave) return;
    onError(null);
    try {
      const payload = {
        name,
        amountCents: parseEurToCents(amount),
        periodMode,
        notes: notes.trim() ? notes : null,
        icon,
        color,
        accountId: accountId || mainAccountId,
        scalable,
        scalableStartPeriodKey: scalable ? startPeriodKey : null,
      };
      if (poolId) {
        await updateBudgetPool({ id: poolId, ...payload, active: existing?.active ?? true });
      } else {
        await createBudgetPool(payload);
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={poolId ? t('budgetPools.editEntry') : t('budgetPools.newEntry')} onClose={onClose}>
      <p className="fh-form-hint">{t('budgetPools.formHint')}</p>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('budgetPools.namePlaceholder')} />
          <OptionalDescriptionInput value={notes} onChange={setNotes} />
        </label>
        <label>
          {t('budgetPools.planned')} (EUR)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="300,00" />
        </label>
        <label>
          {t('budgetPools.periodModeLabel')}
          <select value={periodMode} onChange={(e) => setPeriodMode(e.target.value as BudgetPoolPeriodMode)}>
            <option value="salary_period">{t('budgetPools.periodMode.salary_period')}</option>
            <option value="yearly">{t('budgetPools.periodMode.yearly')}</option>
          </select>
        </label>
        <label>
          {t('transactions.accountLabel')}
          <select value={accountId || mainAccountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('common.icon')}
          <IconPicker value={icon} onChange={setIcon} />
        </label>
        <label>
          {t('common.color')}
          <ColorPicker value={color} onChange={setColor} />
        </label>
        <Checkbox checked={scalable} onChange={setScalable} title={t('budgetPools.scalableHint')}>
          {t('budgetPools.scalable')}
        </Checkbox>
        {scalable ? (
          <label>
            {t('budgetPools.startPeriodLabel')}
            {periodMode === 'yearly' ? (
              <select value={startPeriodKey} onChange={(e) => setStartPeriodKey(e.target.value)}>
                <option value="">{t('budgetPools.startPeriodPlaceholder')}</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            ) : (
              <select value={startPeriodKey} onChange={(e) => setStartPeriodKey(e.target.value)}>
                <option value="">{t('budgetPools.startPeriodPlaceholder')}</option>
                {salaryPeriods.map((period) => {
                  const key = `${period.periodStart}:${period.periodEnd}`;
                  return (
                    <option key={key} value={key}>
                      {period.periodStart} – {period.periodEnd}
                      {period.isCurrent ? ` (${t('budgetPools.currentPeriod')})` : ''}
                    </option>
                  );
                })}
              </select>
            )}
          </label>
        ) : null}
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={() => void save()} disabled={!canSave}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
