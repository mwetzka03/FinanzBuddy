import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { DebtContactDetail, DebtDirection, IsoDate } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { ThAmount, TdAmount } from '../components/data/AmountCells';
import { formatDisplayDate, isoToday } from '../lib/date';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, formatIncomeEurFromCents, parseEurToCents } from '../lib/money';
import {
  createDebtTransaction,
  deleteDebtTransaction,
  getDebtContact,
  updateDebtContact,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { DateInput } from '../components/DateInput';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';

const TX_TABLE_COLS = '110px 120px 1fr 120px 100px';

export function DebtDetailPage() {
  const ui = useUi();
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DebtContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [entryModalOpen, setEntryModalOpen] = useState(false);

  async function refresh() {
    if (!id) return;
    const data = await getDebtContact(id);
    setDetail(data);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  async function deleteTx(txid: string) {
    setError(null);
    await deleteDebtTransaction(txid);
    await refresh();
  }

  function directionLabel(direction: DebtDirection): string {
    return t(`debts.direction.${direction}`);
  }

  if (!detail) {
    return <div style={{ color: ui.colors.textMuted }}>{t('common.loading')}</div>;
  }

  const balanceSummary = (
    <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 15 }}>
      <div>
        <span style={{ color: ui.colors.textMuted }}>{t('debts.owedToMe')}: </span>
        <strong style={{ color: ui.colors.amountPositive }}>
          {formatIncomeEurFromCents(detail.contact.owedToMeCents)}
        </strong>
      </div>
      <div>
        <span style={{ color: ui.colors.textMuted }}>{t('debts.iOwe')}: </span>
        <strong style={{ color: ui.colors.amountNegative }}>
          {formatExpenseEurFromCents(detail.contact.iOweCents)}
        </strong>
      </div>
    </div>
  );

  return (
    <PageShell
      title={detail.contact.name}
      intro={balanceSummary}
      backTo="/schulden"
      backLabel={t('debts.title')}
      error={error}
      headerActions={
        <>
          <button type="button" className="fh-btn ghost" onClick={() => setPersonModalOpen(true)}>
            {t('debts.person')}
          </button>
          <AddEntryButton label={t('debts.newEntry')} onClick={() => setEntryModalOpen(true)} />
        </>
      }
    >
      <ListPanel hint={t('debts.detailListHint')}>
        <AmountTable minWidth={640}>
          <div style={{ ...ui.tableHead, gridTemplateColumns: TX_TABLE_COLS }}>
            <div>{t('common.date')}</div>
            <div>{t('debts.kind')}</div>
            <div style={ui.thName}>{t('common.title')}</div>
            <ThAmount col="amount">{t('common.amount')}</ThAmount>
            <div />
          </div>
          {detail.transactions.length === 0 ? (
            <div style={ui.emptyRow}>{t('debts.noEntries')}</div>
          ) : (
            detail.transactions.map((tx) => {
              const signed = tx.direction === 'owed_to_me' ? tx.amountCents : -Math.abs(tx.amountCents);
              return (
                <div key={tx.id} style={{ ...ui.tableRow, gridTemplateColumns: TX_TABLE_COLS }}>
                  <div style={ui.tdMono}>{formatDisplayDate(tx.date)}</div>
                  <div style={{ ...ui.tdCenter, fontSize: 13 }}>{directionLabel(tx.direction)}</div>
                  <div style={ui.cellStack}>
                    <div>{tx.title ?? t('common.none')}</div>
                    {tx.notes ? <div style={ui.cellSub}>{tx.notes}</div> : null}
                  </div>
                  <TdAmount col="amount" amountCents={signed}>
                    {tx.direction === 'owed_to_me'
                      ? formatIncomeEurFromCents(tx.amountCents)
                      : formatExpenseEurFromCents(tx.amountCents)}
                  </TdAmount>
                  <div style={ui.tdActions}>
                    <TrashIconButton label={t('debts.deleteEntry')} onClick={() => deleteTx(tx.id)} />
                  </div>
                </div>
              );
            })
          )}
        </AmountTable>
      </ListPanel>

      {id && (
        <>
          <EditDebtContactModal
            open={personModalOpen}
            contactId={id}
            contact={detail.contact}
            onClose={() => setPersonModalOpen(false)}
            onSaved={async () => {
              setPersonModalOpen(false);
              await refresh();
            }}
            onError={setError}
          />
          <NewDebtTransactionModal
            open={entryModalOpen}
            contactId={id}
            onClose={() => setEntryModalOpen(false)}
            onSaved={async () => {
              setEntryModalOpen(false);
              await refresh();
            }}
            onError={setError}
          />
        </>
      )}
    </PageShell>
  );
}

function EditDebtContactModal({
  open,
  contactId,
  contact,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  contactId: string;
  contact: DebtContactDetail['contact'];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(contact.name);
    setNotes(contact.notes ?? '');
  }, [open, contact]);

  async function save() {
    if (!name.trim()) return;
    onError(null);
    try {
      await updateDebtContact({ id: contactId, name: name.trim(), notes: notes.trim() || null });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={t('debts.person')} onClose={onClose}>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <OptionalDescriptionInput value={notes} onChange={setNotes} />
        </label>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!name.trim()}>
              {t('debts.savePerson')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NewDebtTransactionModal({
  open,
  contactId,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  contactId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const [txDate, setTxDate] = useState<IsoDate>(() => isoToday());
  const [txAmount, setTxAmount] = useState('');
  const [txDirection, setTxDirection] = useState<DebtDirection>('owed_to_me');
  const [txTitle, setTxTitle] = useState('');
  const [txNotes, setTxNotes] = useState('');

  const directions: DebtDirection[] = ['owed_to_me', 'i_owe'];

  useEffect(() => {
    if (!open) return;
    setTxDate(isoToday());
    setTxAmount('');
    setTxDirection('owed_to_me');
    setTxTitle('');
    setTxNotes('');
  }, [open]);

  async function save() {
    if (!txAmount.trim()) return;
    onError(null);
    try {
      await createDebtTransaction({
        contactId,
        date: txDate,
        amountCents: parseEurToCents(txAmount),
        direction: txDirection,
        title: txTitle.trim() || null,
        notes: txNotes.trim() || null,
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={t('debts.newEntry')} onClose={onClose}>
      <div className="fh-form">
        <div className="fh-form-row">
          <label>
            {t('common.date')}
            <DateInput value={txDate} onChange={setTxDate} />
          </label>
          <label>
            {t('common.amount')} (EUR)
            <input value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="50,00" />
          </label>
        </div>
        <label>
          {t('debts.kind')}
          <select value={txDirection} onChange={(e) => setTxDirection(e.target.value as DebtDirection)}>
            {directions.map((d) => (
              <option key={d} value={d}>
                {t(`debts.direction.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('common.title')}
          <input
            value={txTitle}
            onChange={(e) => setTxTitle(e.target.value)}
            placeholder={t('debts.entryPlaceholder')}
          />
          <OptionalDescriptionInput value={txNotes} onChange={setTxNotes} />
        </label>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!txAmount.trim()}>
              {t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
