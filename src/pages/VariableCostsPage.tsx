import { useEffect, useMemo, useState } from 'react';
import type { Account, VariableCost } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { ColorPicker, EntityIconBadge, IconPicker } from '../components/common/AppIcon';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { VariableCostDetailModal } from '../components/variableCosts/VariableCostDetailModal';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, parseEurToCents } from '../lib/money';
import { createVariableCost, deleteVariableCost, listAccounts, listVariableCosts, updateVariableCost } from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';

const TABLE_COLS = '48px minmax(160px, 1.4fr) 120px 120px 72px';

export function VariableCostsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<VariableCost[]>([]);
  type VariableCostSortKey = 'name' | 'forecast' | 'actual';
  const [sort, setSort] = useState<SortState<VariableCostSortKey>>(null);
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        name: (r) => r.name,
        forecast: (r) => r.amountCents,
        actual: (r) => r.currentMonthActualCents,
      }),
    [rows, sort],
  );
  const pagination = useTablePagination(sortedRows);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function refresh() {
    setRows(await listVariableCosts());
    listAccounts().then(setAccounts).catch(() => undefined);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function openCreate() {
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(row: VariableCost) {
    setEditingId(row.id);
    setModalOpen(true);
  }

  async function onDelete(id: string) {
    setError(null);
    await deleteVariableCost(id);
    await refresh();
  }

  return (
    <PageShell
      title={t('variableCosts.title')}
      intro={t('variableCosts.intro')}
      error={error}
      headerActions={<AddEntryButton label={t('variableCosts.newEntry')} onClick={openCreate} />}
    >
      <ListPanel hint={t('variableCosts.listHint')}>
        <AmountTable>
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
            <div />
            <SortableTh label={t('common.name')} sortKey="name" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh
              label={t('variableCosts.forecast')}
              sortKey="forecast"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="forecast"
            />
            <SortableTh
              label={t('variableCosts.actual')}
              sortKey="actual"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="actual"
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="fh-link-button" style={ui.nameLink} onClick={() => setDetailId(r.id)}>
                      {r.name}
                    </button>
                  </div>
                  {r.notes ? <div style={ui.cellSub}>{r.notes}</div> : null}
                </div>
                <TdAmount col="forecast" amountCents={-r.amountCents}>
                  {formatExpenseEurFromCents(r.amountCents)}
                </TdAmount>
                <TdAmount col="actual" amountCents={-r.currentMonthActualCents}>
                  {formatExpenseEurFromCents(r.currentMonthActualCents)}
                  {!r.currentMonthClosed && r.currentMonthSpentCents > 0 ? (
                    <div style={{ fontSize: 11, color: ui.colors.textMuted, marginTop: 4, fontWeight: 400 }}>
                      {t('variableCosts.spent')}: {formatExpenseEurFromCents(r.currentMonthSpentCents)}
                    </div>
                  ) : null}
                </TdAmount>
                <div style={ui.tdActions}>
                  <EditIconButton label={t('common.edit')} onClick={() => openEdit(r)} />
                  <TrashIconButton label={t('common.delete')} onClick={() => onDelete(r.id)} />
                </div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <VariableCostDetailModal open={detailId !== null} costId={detailId} onClose={() => setDetailId(null)} />

      <VariableCostModal
        open={modalOpen}
        costId={editingId}
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

function VariableCostModal({
  open,
  costId,
  rows,
  accounts,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  costId: string | null;
  rows: VariableCost[];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const existing = costId ? rows.find((r) => r.id === costId) : undefined;
  const mainAccountId = accounts.find((a) => a.isMain)?.id ?? accounts[0]?.id ?? '';

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [icon, setIcon] = useState('shop');
  const [color, setColor] = useState('#6366f1');
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setAmount(existing ? (existing.amountCents / 100).toFixed(2).replace('.', ',') : '');
    setNotes(existing?.notes ?? '');
    setIcon(existing?.icon ?? 'shop');
    setColor(existing?.color ?? '#6366f1');
    setAccountId(existing?.accountId ?? mainAccountId);
  }, [open, existing, mainAccountId]);

  async function save() {
    if (!name.trim() || !amount.trim()) return;
    onError(null);
    try {
      const payload = {
        name,
        amountCents: parseEurToCents(amount),
        notes: notes.trim() ? notes : null,
        icon,
        color,
        accountId: accountId || mainAccountId,
      };
      if (costId) {
        await updateVariableCost({ id: costId, ...payload });
      } else {
        await createVariableCost(payload);
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal
      open={open}
      title={costId ? t('variableCosts.editEntry') : t('variableCosts.newEntry')}
      onClose={onClose}
    >
      <p className="fh-form-hint">{t('variableCosts.formHint')}</p>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('variableCosts.namePlaceholder')} />
          <OptionalDescriptionInput value={notes} onChange={setNotes} />
        </label>
        <label>
          {t('variableCosts.forecast')} (EUR/{t('common.month')})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="45,00" />
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
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!name.trim() || !amount.trim()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
