import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Modal } from '../components/common/Modal';
import { ThAmount, TdAmount } from '../components/data/AmountCells';
import { DataGrid, DataGridRow } from '../components/data/DataGrid';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { DetailLink } from '../components/DetailLink';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';
import { useAsyncLoad } from '../hooks/useAsyncLoad';
import { usePageRequest } from '../hooks/usePageRequest';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, formatIncomeEurFromCents } from '../lib/money';
import type { DebtContactSummary } from '../lib/types';
import { useUi } from '../lib/ui';
import { createDebtContact, deleteDebtContact, listDebtContacts } from '../tauri/api';

const TABLE_COLS = 'minmax(140px, 1.2fr) 120px 120px 160px';

export function DebtsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const { error, setError, run } = usePageRequest();
  const [rows, setRows] = useState<DebtContactSummary[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const pagination = useTablePagination(rows);

  const refresh = useCallback(async () => {
    setRows(await listDebtContacts());
  }, []);

  useAsyncLoad(useCallback(() => run(refresh), [run, refresh]));

  function openCreate() {
    setModalOpen(true);
  }

  async function onDelete(id: string) {
    await run(async () => {
      await deleteDebtContact(id);
      await refresh();
    });
  }

  return (
    <PageShell
      title={t('debts.title')}
      intro={t('debts.intro')}
      error={error}
      headerActions={<AddEntryButton label={t('debts.newPerson')} onClick={openCreate} />}
    >
      <ListPanel hint={t('debts.listHint')}>
        <DataGrid
          columns={TABLE_COLS}
          minWidth={640}
          isEmpty={rows.length === 0}
          emptyMessage={t('common.noPersons')}
          header={
            <>
              <div style={ui.thName}>{t('common.name')}</div>
              <ThAmount col="owed">{t('debts.owedToMe')}</ThAmount>
              <ThAmount col="owe">{t('debts.iOwe')}</ThAmount>
              <div style={ui.tdActions} />
            </>
          }
        >
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
          {pagination.pageItems.map((r) => (
            <DataGridRow key={r.id} columns={TABLE_COLS} className="fh-data-grid__row">
              <div style={ui.cellStack}>
                <div style={ui.tdName}>
                  <DetailLink to={`/schulden/${r.id}`}>{r.name}</DetailLink>
                </div>
                {r.notes ? <div style={ui.cellSub}>{r.notes}</div> : null}
              </div>
              <TdAmount col="owed" amountCents={r.owedToMeCents}>
                {formatIncomeEurFromCents(r.owedToMeCents)}
              </TdAmount>
              <TdAmount col="owe" amountCents={-r.iOweCents}>
                {formatExpenseEurFromCents(r.iOweCents)}
              </TdAmount>
              <div style={ui.tdActions}>
                <Link to={`/schulden/${r.id}`} style={{ ...ui.btnGhost, textDecoration: 'none' }} className="fh-btn">
                  {t('debts.entries')}
                </Link>
                <TrashIconButton label={t('debts.deletePerson')} onClick={() => onDelete(r.id)} />
              </div>
            </DataGridRow>
          ))}
        </DataGrid>
      </ListPanel>

      <NewDebtContactModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await run(refresh);
        }}
        onError={setError}
      />
    </PageShell>
  );
}

function NewDebtContactModal({
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
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setNotes('');
  }, [open]);

  async function save() {
    if (!name.trim()) return;
    onError(null);
    try {
      await createDebtContact({ name: name.trim(), notes: notes.trim() || null });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={t('debts.newPerson')} onClose={onClose}>
      <p className="fh-form-hint">{t('debts.formHint')}</p>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('debts.namePlaceholder')}
          />
          <OptionalDescriptionInput value={notes} onChange={setNotes} />
        </label>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!name.trim()}>
              {t('common.create')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
