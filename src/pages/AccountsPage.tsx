import { useEffect, useMemo, useState } from 'react';
import type { Account, LedgerTransaction } from '../lib/types';
import { accountKindLabel, buildAccountTreeRows, isMainAccountCandidate, isOberspartopf } from '../lib/accounts';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { AccountFormModal } from '../components/settings/AccountFormModal';
import {
  createTransfer,
  deleteTransfer,
  listAccounts,
  listLedgerTransactions,
  setMainAccount,
} from '../tauri/api';
import { formatDisplayDate, isoToday } from '../lib/date';
import { formatSignedEurFromCents, parseEurToCents } from '../lib/money';
import { useUi } from '../lib/ui';
import { useLocale } from '../i18n/LocaleProvider';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { DateInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';

const ACCOUNT_COLS = '1fr 160px 48px';
const TRANSFER_COLS = '120px 1fr 1fr 120px 120px';

export function AccountsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<LedgerTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [transferModalOpen, setTransferModalOpen] = useState(false);

  const accountMap = useMemo(() => new Map(rows.map((a) => [a.id, a.name])), [rows]);
  const treeRows = useMemo(() => buildAccountTreeRows(rows), [rows]);
  const mainAccountId = useMemo(() => rows.find((a) => a.isMain)?.id ?? '', [rows]);
  const mainAccountCandidates = useMemo(() => rows.filter(isMainAccountCandidate), [rows]);
  type TransferSortKey = 'date' | 'from' | 'to' | 'amount';
  const [transferSort, setTransferSort] = useState<SortState<TransferSortKey>>(null);
  const sortedTransfers = useMemo(
    () =>
      sortByState(transfers, transferSort, {
        date: (tx) => tx.date,
        from: (tx) => accountMap.get(tx.fromAccountId ?? '') ?? '',
        to: (tx) => accountMap.get(tx.toAccountId ?? '') ?? '',
        amount: (tx) => Math.abs(tx.amountCents),
      }),
    [transfers, transferSort, accountMap],
  );
  const accountsPagination = useTablePagination(treeRows);
  const transfersPagination = useTablePagination(sortedTransfers);

  async function refresh() {
    const [accounts, ledger] = await Promise.all([listAccounts(), listLedgerTransactions({})]);
    setRows(accounts);
    setTransfers(ledger.filter((tx) => tx.kind === 'transfer'));
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onSetMain(id: string) {
    setError(null);
    await setMainAccount(id);
    await refresh();
  }

  async function onUndoTransfer(id: string) {
    setError(null);
    await deleteTransfer(id);
    await refresh();
  }

  return (
    <PageShell
      title={t('accounts.title')}
      intro={t('accounts.intro')}
      error={error}
      headerActions={
        <>
          <AddEntryButton label={t('accounts.newAccount')} onClick={() => setAccountModalOpen(true)} />
          <button type="button" className="fh-btn" onClick={() => setTransferModalOpen(true)}>
            {t('accounts.transfer')}
          </button>
        </>
      }
    >
      <ListPanel title={t('accounts.listTitle')} hint={t('accounts.listHint')}>
        <label style={{ ...ui.field, maxWidth: 360, marginBottom: 16 }}>
          <span style={ui.label}>{t('accounts.mainAccount')}</span>
          <select value={mainAccountId} onChange={(e) => onSetMain(e.target.value)} style={ui.input}>
            {mainAccountCandidates.length === 0 ? <option value="">{t('common.noManualAccount')}</option> : null}
            {mainAccountCandidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div style={ui.tableScroll}>
          <div style={ui.table}>
            <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: ACCOUNT_COLS }}>
              <div style={ui.thName}>{t('common.name')}</div>
              <div>{t('accounts.accountKind')}</div>
              <div />
            </div>
            <TablePaginationBar
              page={accountsPagination.page}
              totalPages={accountsPagination.totalPages}
              totalItems={accountsPagination.totalItems}
              pageSize={accountsPagination.pageSize}
              onPageChange={accountsPagination.setPage}
            />
            {rows.length === 0 ? (
              <div style={ui.emptyRow}>{t('common.noAccountsYet')}</div>
            ) : (
            accountsPagination.pageItems.map(({ account: a, depth }) => (
              <div key={a.id} style={{ ...ui.tableRow, gridTemplateColumns: ACCOUNT_COLS }}>
                <div style={{ ...ui.cellStack, paddingLeft: depth * 18 }}>
                  <span>
                    {a.name}
                    {a.isMain ? t('accounts.mainAccountSuffix') : ''}
                  </span>
                  {a.iban ? <span style={{ ...ui.cellSub, fontSize: '0.85em' }}>{a.iban}</span> : null}
                </div>
                  <div>{accountKindLabel(a, t)}</div>
                  <div style={{ ...ui.tdActions, justifyContent: 'flex-end' }}>
                    {!isOberspartopf(a) ? (
                      <EditIconButton label={t('accounts.editAccount')} onClick={() => setEditAccount(a)} />
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </ListPanel>

      <ListPanel title={t('accounts.transferHistory')} hint={t('accounts.transferHint')}>
        <AmountTable>
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TRANSFER_COLS }}>
            <SortableTh label={t('common.date')} sortKey="date" sort={transferSort} onSort={setTransferSort} />
            <SortableTh label={t('common.from')} sortKey="from" sort={transferSort} onSort={setTransferSort} />
            <SortableTh label={t('common.to')} sortKey="to" sort={transferSort} onSort={setTransferSort} />
            <SortableTh
              label={t('common.amount')}
              sortKey="amount"
              sort={transferSort}
              onSort={setTransferSort}
              style={ui.thAmount}
              align="center"
            />
            <div />
          </div>
          <TablePaginationBar
            page={transfersPagination.page}
            totalPages={transfersPagination.totalPages}
            totalItems={transfersPagination.totalItems}
            pageSize={transfersPagination.pageSize}
            onPageChange={transfersPagination.setPage}
          />
          {transfers.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.noTransfers')}</div>
          ) : (
            transfersPagination.pageItems.map((tx) => (
              <div key={tx.id} style={{ ...ui.tableRow, gridTemplateColumns: TRANSFER_COLS }}>
                <div style={ui.tdMono}>{formatDisplayDate(tx.date)}</div>
                <div style={ui.tdCenter}>{accountMap.get(tx.fromAccountId ?? '') ?? t('common.none')}</div>
                <div style={ui.tdCenter}>{accountMap.get(tx.toAccountId ?? '') ?? t('common.none')}</div>
                <TdAmount col="amount" amountCents={-Math.abs(tx.amountCents)}>
                  {formatSignedEurFromCents(-Math.abs(tx.amountCents))}
                </TdAmount>
                <div style={ui.tdActions}>
                  <button style={ui.btn} onClick={() => onUndoTransfer(tx.id)}>
                    {t('common.undo')}
                  </button>
                </div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <AccountFormModal
        mode="create"
        open={accountModalOpen}
        allAccounts={rows}
        onClose={() => setAccountModalOpen(false)}
        onSaved={async () => {
          setAccountModalOpen(false);
          await refresh();
        }}
        onError={setError}
      />

      <AccountFormModal
        mode="edit"
        open={editAccount != null}
        account={editAccount}
        allAccounts={rows}
        onClose={() => setEditAccount(null)}
        onSaved={async () => {
          setEditAccount(null);
          await refresh();
        }}
        onError={setError}
      />

      <TransferModal
        open={transferModalOpen}
        accountOptions={rows.map((a) => ({ id: a.id, name: a.name }))}
        onClose={() => setTransferModalOpen(false)}
        onSaved={async () => {
          setTransferModalOpen(false);
          await refresh();
        }}
        onError={setError}
      />
    </PageShell>
  );
}

function TransferModal({
  open,
  accountOptions,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  accountOptions: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [tDate, setTDate] = useState(isoToday());
  const [tAmount, setTAmount] = useState('');
  const [tTitle, setTTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    setFromId('');
    setToId('');
    setTDate(isoToday());
    setTAmount('');
    setTTitle(t('accounts.defaultTransferTitle'));
  }, [open, t]);

  async function save() {
    if (!fromId || !toId || !tAmount.trim()) return;
    onError(null);
    try {
      const cents = parseEurToCents(tAmount);
      await createTransfer({
        date: tDate,
        amountCents: cents,
        fromAccountId: fromId,
        toAccountId: toId,
        title: tTitle.trim() ? tTitle : t('accounts.defaultTransferTitle'),
        notes: null,
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={t('accounts.transfer')} onClose={onClose}>
      <p className="fh-form-hint">{t('accounts.transferDesc')}</p>
      <div className="fh-form">
        <label>
          {t('common.from')}
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">{t('common.none')}</option>
            {accountOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('common.to')}
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">{t('common.none')}</option>
            {accountOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('common.date')}
          <DateInput value={tDate} onChange={setTDate} />
        </label>
        <label>
          {t('common.amount')} (EUR)
          <input value={tAmount} onChange={(e) => setTAmount(e.target.value)} placeholder="100,00" />
        </label>
        <label>
          {t('common.title')}
          <input value={tTitle} onChange={(e) => setTTitle(e.target.value)} />
        </label>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button
              type="button"
              className="fh-btn primary"
              onClick={save}
              disabled={!fromId || !toId || !tAmount.trim()}
            >
              {t('common.book')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
