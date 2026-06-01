import { useEffect, useMemo, useState } from 'react';
import type { Account, AccountBalanceSource, LedgerTransaction } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { ThAmount, TdAmount } from '../components/data/AmountCells';
import {
  createAccount,
  createTransfer,
  deleteTransfer,
  listAccounts,
  listLedgerTransactions,
  setAccountLiquid,
  setMainAccount,
  updateAccount,
} from '../tauri/api';
import { formatDisplayDate, isoToday } from '../lib/date';
import { formatSignedEurFromCents, parseEurToCents } from '../lib/money';
import { useUi } from '../lib/ui';
import { useLocale } from '../i18n/LocaleProvider';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { DateInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { SaveIconButton } from '../components/SaveIconButton';
import { CancelIconButton } from '../components/CancelIconButton';

const ACCOUNT_COLS = '1fr 120px 140px 140px';
const TRANSFER_COLS = '120px 1fr 1fr 120px 120px';

export function AccountsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<LedgerTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const accountMap = useMemo(() => new Map(rows.map((a) => [a.id, a.name])), [rows]);
  const mainAccountId = useMemo(() => rows.find((a) => a.isMain)?.id ?? '', [rows]);
  const ledgerAccounts = useMemo(() => rows.filter((a) => a.balanceSource === 'ledger'), [rows]);

  async function refresh() {
    const [accounts, ledger] = await Promise.all([listAccounts(), listLedgerTransactions({})]);
    setRows(accounts);
    setTransfers(ledger.filter((tx) => tx.kind === 'transfer'));
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onToggleLiquid(a: Account) {
    setError(null);
    await setAccountLiquid({ id: a.id, isLiquid: !a.isLiquid });
    await refresh();
  }

  async function onSetMain(id: string) {
    setError(null);
    await setMainAccount(id);
    await refresh();
  }

  function startEditName(a: Account) {
    setEditingId(a.id);
    setEditName(a.name);
  }

  async function saveEditName(id: string) {
    setError(null);
    await updateAccount({ id, name: editName.trim() });
    setEditingId(null);
    await refresh();
  }

  function balanceSourceLabel(source: AccountBalanceSource): string {
    return source === 'stock_portfolio' ? t('accounts.balanceSourceStock') : t('accounts.balanceSourceLedger');
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
            {ledgerAccounts.length === 0 ? <option value="">{t('common.noManualAccount')}</option> : null}
            {ledgerAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div style={ui.tableScroll}>
          <div style={ui.table}>
            <div style={{ ...ui.tableHead, gridTemplateColumns: ACCOUNT_COLS }}>
              <div style={ui.thName}>{t('common.name')}</div>
              <div>{t('accounts.liquid')}</div>
              <div>{t('accounts.balanceSource')}</div>
              <div />
            </div>
            {rows.length === 0 ? (
              <div style={ui.emptyRow}>{t('common.noAccountsYet')}</div>
            ) : (
              rows.map((a) => (
                <div key={a.id} style={{ ...ui.tableRow, gridTemplateColumns: ACCOUNT_COLS }}>
                  {editingId === a.id ? (
                    <>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} style={ui.input} />
                        <SaveIconButton label={t('common.save')} onClick={() => saveEditName(a.id)} />
                        <CancelIconButton label={t('common.cancel')} onClick={() => setEditingId(null)} />
                      </div>
                      <div />
                      <div />
                      <div />
                    </>
                  ) : (
                    <>
                      <div style={{ ...ui.tdName, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>
                          {a.name}
                          {a.isMain ? t('accounts.mainAccountSuffix') : ''}
                        </span>
                        <EditIconButton label={t('accounts.editName')} onClick={() => startEditName(a)} />
                      </div>
                      <div style={ui.tdCenter}>{a.isLiquid ? t('common.yes') : t('common.no')}</div>
                      <div style={{ ...ui.tdCenter, fontSize: 13 }}>{balanceSourceLabel(a.balanceSource)}</div>
                      <div style={ui.tdActions}>
                        <button style={ui.btn} onClick={() => onToggleLiquid(a)}>
                          {a.isLiquid ? t('accounts.notLiquid') : t('accounts.liquid')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </ListPanel>

      <ListPanel title={t('accounts.transferHistory')} hint={t('accounts.transferHint')}>
        <AmountTable>
          <div style={{ ...ui.tableHead, gridTemplateColumns: TRANSFER_COLS }}>
            <div>{t('common.date')}</div>
            <div>{t('common.from')}</div>
            <div>{t('common.to')}</div>
            <ThAmount col="amount">{t('common.amount')}</ThAmount>
            <div />
          </div>
          {transfers.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.noTransfers')}</div>
          ) : (
            transfers.map((tx) => (
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

      <AccountModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        onSaved={async () => {
          setAccountModalOpen(false);
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

function AccountModal({
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
  const [isLiquid, setIsLiquid] = useState(true);
  const [balanceSource, setBalanceSource] = useState<AccountBalanceSource>('ledger');

  useEffect(() => {
    if (!open) return;
    setName('');
    setIsLiquid(true);
    setBalanceSource('ledger');
  }, [open]);

  async function save() {
    if (!name.trim()) return;
    onError(null);
    try {
      await createAccount({ name, isLiquid, balanceSource });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={t('accounts.newAccount')} onClose={onClose}>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('accounts.namePlaceholder')}
          />
        </label>
        <label>
          {t('accounts.balanceSource')}
          <select
            value={balanceSource}
            onChange={(e) => setBalanceSource(e.target.value as AccountBalanceSource)}
          >
            <option value="ledger">{t('accounts.balanceSourceLedger')}</option>
            <option value="stock_portfolio">{t('accounts.balanceSourceStock')}</option>
          </select>
        </label>
        <Checkbox checked={isLiquid} onChange={setIsLiquid}>
          {t('accounts.liquid')}
        </Checkbox>
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
