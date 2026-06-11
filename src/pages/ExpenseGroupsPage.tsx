import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExpenseGroupSummary, IsoDate } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { DetailLink } from '../components/DetailLink';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { DateInput } from '../components/DateInput';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';
import { type LineDraft, parseLineDrafts } from '../domain/expenseGroup/lineDraft';
import { formatDisplayDate, isoToday } from '../lib/date';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents } from '../lib/money';
import { useUi } from '../lib/ui';
import { createExpenseGroup, deleteExpenseGroup, listExpenseGroups } from '../tauri/api';

const TABLE_COLS = 'minmax(140px, 1.2fr) 110px 100px 180px';

export function ExpenseGroupsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<ExpenseGroupSummary[]>([]);
  type ExpenseGroupSortKey = 'name' | 'total' | 'lines' | 'date';
  const [sort, setSort] = useState<SortState<ExpenseGroupSortKey>>(null);
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        name: (r) => r.name,
        total: (r) => r.totalCents,
        lines: (r) => r.lineCount,
        date: (r) => r.date ?? '',
      }),
    [rows, sort],
  );
  const pagination = useTablePagination(sortedRows);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function refresh() {
    setRows(await listExpenseGroups());
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function openCreate() {
    setModalOpen(true);
  }

  async function onDelete(id: string) {
    setError(null);
    await deleteExpenseGroup(id);
    await refresh();
  }

  return (
    <PageShell
      title={t('expenseGroups.title')}
      intro={t('expenseGroups.intro')}
      error={error}
      headerActions={<AddEntryButton label={t('expenseGroups.newGroup')} onClick={openCreate} />}
    >
      <ListPanel hint={t('expenseGroups.listHint')}>
        <AmountTable minWidth={640}>
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
            <SortableTh label={t('common.name')} sortKey="name" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh
              label={t('common.total')}
              sortKey="total"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
            />
            <SortableTh label={t('common.lines')} sortKey="lines" sort={sort} onSort={setSort} style={ui.thCenter} />
            <div style={ui.tdActions} />
          </div>
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
          {rows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.noGroups')}</div>
          ) : (
            pagination.pageItems.map((r) => (
              <div key={r.id} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                <div style={ui.cellStack}>
                  <div style={ui.tdName}>
                    <DetailLink to={`/ausgabengruppen/${r.id}`}>{r.name}</DetailLink>
                  </div>
                  {r.notes ? <div style={ui.cellSub}>{r.notes}</div> : null}
                  {r.date && <div style={ui.cellSub}>{formatDisplayDate(r.date)}</div>}
                </div>
                <TdAmount col="total" amountCents={-r.totalCents}>
                  {formatExpenseEurFromCents(r.totalCents)}
                </TdAmount>
                <div style={ui.tdCenter}>{r.lineCount}</div>
                <div style={ui.tdActions}>
                  <Link to={`/ausgabengruppen/${r.id}`} style={{ ...ui.btn, textDecoration: 'none' }} className="fh-btn">
                    {t('expenseGroups.open')}
                  </Link>
                  <TrashIconButton label={t('expenseGroups.deleteGroup')} onClick={() => onDelete(r.id)} />
                </div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <NewExpenseGroupModal
        open={modalOpen}
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

function NewExpenseGroupModal({
  open,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [date, setDate] = useState<IsoDate>(() => isoToday());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ name: '', amount: '' }]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDate(isoToday());
    setNotes('');
    setLines([{ name: '', amount: '' }]);
  }, [open]);

  function addLine() {
    setLines((prev) => [...prev, { name: '', amount: '' }]);
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const parsed = parseLineDrafts(lines);
  const canSave = name.trim().length > 0 && parsed.length > 0;

  async function save() {
    if (!canSave) return;
    onError(null);
    try {
      await createExpenseGroup({ name: name.trim(), date, notes: notes.trim() || null, lines: parsed });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={t('expenseGroups.newGroup')} onClose={onClose}>
      <p className="fh-form-hint">{t('expenseGroups.formHint')}</p>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('expenseGroups.namePlaceholder')}
          />
          <OptionalDescriptionInput value={notes} onChange={setNotes} />
        </label>
        <label>
          {t('common.date')}
          <DateInput value={date} onChange={setDate} />
        </label>
        <div>
          <div className="fh-form-label">{t('common.lineItems')}</div>
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input
                value={line.name}
                onChange={(e) => updateLine(idx, { name: e.target.value })}
                placeholder={t('expenseGroups.linePlaceholder')}
                style={{ flex: 1 }}
              />
              <input
                value={line.amount}
                onChange={(e) => updateLine(idx, { amount: e.target.value })}
                placeholder="EUR"
                style={{ width: 110, textAlign: 'right' }}
              />
              <button type="button" className="fh-btn" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                −
              </button>
            </div>
          ))}
          <button type="button" className="fh-btn" onClick={addLine}>
            {t('expenseGroups.addLine')}
          </button>
        </div>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!canSave}>
              {t('common.createGroup')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
