import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Account, LedgerTransaction, VariableCost } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { ColorPicker, EntityIconBadge, IconPicker } from '../components/common/AppIcon';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { ThAmount, TdAmount } from '../components/data/AmountCells';
import { IncomeForecastsPanel } from '../components/income/IncomeForecastsPanel';
import { formatDisplayDate, isoToday } from '../lib/date';
import { formatEurFromCents, formatSignedEurFromCents, parseEurToCents } from '../lib/money';
import {
  createLedgerTransaction,
  deleteLedgerTransaction,
  deleteTransfer,
  listAccounts,
  listLedgerTransactions,
  listVariableCosts,
  updateLedgerTransaction,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { DateInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';
import { VariableCostSuggestField } from '../components/variableCosts/VariableCostSuggestField';
import { useLocale } from '../i18n/LocaleProvider';
import { DEFAULT_KIND_COLOR, DEFAULT_KIND_ICON } from '../lib/icons';

const TABLE_COLS = '48px 120px 120px minmax(160px, 1.5fr) minmax(140px, 1fr) 120px 72px';

function kindLabel(kind: string, t: (key: string) => string): string {
  const key = `transactions.kinds.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
}

function rowTitle(row: LedgerTransaction, accountMap: Map<string, string>): string {
  if (row.kind === 'transfer') {
    const from = accountMap.get(row.fromAccountId ?? '') ?? '—';
    const to = accountMap.get(row.toAccountId ?? '') ?? '—';
    return `${from} → ${to}`;
  }
  return row.title;
}

function formatRowAmount(row: LedgerTransaction): string {
  if (row.kind === 'adjustment') {
    return formatEurFromCents(Math.abs(row.amountCents));
  }
  return formatSignedEurFromCents(row.amountCents);
}

function isEditableKind(kind: string): boolean {
  return kind !== 'transfer';
}

function canAssignCategory(kind: string): boolean {
  return kind === 'expense';
}

function amountCentsForKind(k: 'income' | 'expense' | 'adjustment', cents: number): number {
  if (k === 'adjustment') return Math.abs(cents);
  if (k === 'income') return Math.abs(cents);
  return -Math.abs(cents);
}

type ViewMode = 'transactions' | 'forecasts';

export function TransactionsPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: ViewMode = searchParams.get('view') === 'forecasts' ? 'forecasts' : 'transactions';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [variableCosts, setVariableCosts] = useState<VariableCost[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [rows, setRows] = useState<LedgerTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<LedgerTransaction | null>(null);

  const ledgerAccounts = useMemo(() => accounts.filter((a) => a.balanceSource === 'ledger'), [accounts]);
  const variableCostMap = useMemo(() => new Map(variableCosts.map((c) => [c.id, c.name])), [variableCosts]);
  const accountOptions = useMemo(() => ledgerAccounts.map((a) => ({ id: a.id, name: a.name })), [ledgerAccounts]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const selectedAccount = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
  const isStockDepot = selectedAccount?.balanceSource === 'stock_portfolio';

  function setView(next: ViewMode) {
    if (next === 'forecasts') {
      setSearchParams({ view: 'forecasts' });
    } else {
      setSearchParams({});
    }
    setError(null);
  }

  async function refresh() {
    setRows(
      await listLedgerTransactions({
        accountId: accountId || undefined,
      }),
    );
  }

  useEffect(() => {
    listAccounts()
      .then((a) => {
        setAccounts(a);
        const ledger = a.filter((x) => x.balanceSource === 'ledger');
        if (!accountId && ledger[0]) setAccountId(ledger[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    listVariableCosts()
      .then(setVariableCosts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== 'transactions') return;
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [accountId, view]);

  function openCreate() {
    setEditingRow(null);
    setModalOpen(true);
  }

  function openEdit(row: LedgerTransaction) {
    setEditingRow(row);
    setModalOpen(true);
  }

  async function onDelete(row: LedgerTransaction) {
    setError(null);
    if (row.kind === 'transfer') {
      await deleteTransfer(row.id);
    } else {
      await deleteLedgerTransaction(row.id);
    }
    await refresh();
  }

  const intro = view === 'forecasts' ? t('transactions.forecastIntro') : t('transactions.intro');

  return (
    <PageShell
      title={t('transactions.title')}
      intro={intro}
      error={error}
      headerBefore={
        <div className="fh-page-segment-row">
          <div className="fh-segment">
            <button type="button" onClick={() => setView('transactions')} className={view === 'transactions' ? 'active' : ''}>
              {t('transactions.tabLedger')}
            </button>
            <button type="button" onClick={() => setView('forecasts')} className={view === 'forecasts' ? 'active' : ''}>
              {t('transactions.tabForecasts')}
            </button>
          </div>
        </div>
      }
    >
      {view === 'forecasts' ? (
        <IncomeForecastsPanel onError={setError} />
      ) : (
        <>
          <div className="fh-transactions-toolbar">
            <label style={{ ...ui.field, width: '100%', maxWidth: 320, marginBottom: 0 }}>
              <span style={ui.label}>{t('transactions.accountLabel')}</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={ui.input}>
                {accountOptions.length === 0 ? <option value="">{t('common.noAccounts')}</option> : null}
                {accountOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            {!isStockDepot ? (
              <div className="fh-transactions-toolbar__actions">
                <AddEntryButton label={t('transactions.newEntry')} onClick={openCreate} disabled={!accountId} />
              </div>
            ) : null}
          </div>

          {isStockDepot && (
            <p style={{ margin: '0 0 16px', color: ui.colors.textMuted, fontSize: 14 }}>{t('transactions.stockDepotHint')}</p>
          )}

          <ListPanel title={t('transactions.history')} hint={t('transactions.historyHint')}>
            <AmountTable>
              <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
                <div />
                <div>{t('common.date')}</div>
                <div>{t('common.type')}</div>
                <div>{t('transactions.titleField')}</div>
                <div>{t('common.category')}</div>
                <ThAmount col="amount">{t('common.amount')}</ThAmount>
                <div />
              </div>
              {rows.length === 0 ? (
                <div style={{ padding: 12, color: ui.colors.textMuted }}>{t('transactions.empty')}</div>
              ) : (
                rows.map((r) => (
                  <div key={r.id} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                    <EntityIconBadge
                      icon={r.icon || DEFAULT_KIND_ICON[r.kind] || 'target'}
                      color={r.color || DEFAULT_KIND_COLOR[r.kind] || '#6366f1'}
                      size={18}
                    />
                    <div style={{ fontFamily: 'monospace' }}>{formatDisplayDate(r.date)}</div>
                    <div>{kindLabel(r.kind, t)}</div>
                    <div style={ui.cellStack}>
                      <div>{rowTitle(r, accountMap)}</div>
                      {r.notes ? <div style={ui.cellSub}>{r.notes}</div> : null}
                    </div>
                    <div style={{ color: ui.colors.textMuted, fontSize: 13 }}>
                      {r.variableCostId ? variableCostMap.get(r.variableCostId) ?? t('common.none') : t('common.none')}
                    </div>
                    <TdAmount col="amount" amountCents={r.kind === 'adjustment' ? Math.abs(r.amountCents) : r.amountCents}>
                      {formatRowAmount(r)}
                    </TdAmount>
                    <div style={ui.tdActions}>
                      {r.kind === 'transfer' ? (
                        <TrashIconButton label={t('transactions.undoTransfer')} onClick={() => onDelete(r)} />
                      ) : isEditableKind(r.kind) ? (
                        <>
                          <EditIconButton label={t('common.edit')} onClick={() => openEdit(r)} />
                          <TrashIconButton label={t('common.delete')} onClick={() => onDelete(r)} />
                        </>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </AmountTable>
          </ListPanel>

          <TransactionModal
            open={modalOpen}
            row={editingRow}
            accountId={accountId}
            variableCosts={variableCosts}
            onClose={() => setModalOpen(false)}
            onSaved={async () => {
              setModalOpen(false);
              await refresh();
            }}
            onError={setError}
          />
        </>
      )}
    </PageShell>
  );
}

function TransactionModal({
  open,
  row,
  accountId,
  variableCosts,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  row: LedgerTransaction | null;
  accountId: string;
  variableCosts: VariableCost[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const isEdit = !!row;

  const [date, setDate] = useState(isoToday());
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'income' | 'expense' | 'adjustment'>('expense');
  const [variableCostId, setVariableCostId] = useState<string | null>(null);
  const [icon, setIcon] = useState(DEFAULT_KIND_ICON.expense);
  const [color, setColor] = useState(DEFAULT_KIND_COLOR.expense);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setDate(row.date);
      setAmount((Math.abs(row.amountCents) / 100).toFixed(2).replace('.', ','));
      setTitle(row.title);
      setDescription(row.notes ?? '');
      if (row.kind === 'income' || row.kind === 'expense' || row.kind === 'adjustment') {
        setKind(row.kind);
      } else {
        setKind('expense');
      }
      setVariableCostId(row.variableCostId);
      setIcon(row.icon || DEFAULT_KIND_ICON[row.kind] || 'target');
      setColor(row.color || DEFAULT_KIND_COLOR[row.kind] || '#6366f1');
    } else {
      setDate(isoToday());
      setAmount('');
      setTitle('');
      setDescription('');
      setKind('expense');
      setVariableCostId(null);
      setIcon(DEFAULT_KIND_ICON.expense);
      setColor(DEFAULT_KIND_COLOR.expense);
    }
  }, [open, row]);

  async function save() {
    if (!amount.trim() || !accountId) return;
    onError(null);
    try {
      const cents = parseEurToCents(amount);
      if (isEdit && row) {
        let amountCents: number;
        let finalKind = row.kind;

        if (row.kind === 'buy_apply') {
          amountCents = -Math.abs(cents);
        } else {
          finalKind = kind;
          amountCents = amountCentsForKind(kind, cents);
        }

        await updateLedgerTransaction({
          id: row.id,
          date,
          amountCents,
          kind: finalKind,
          title: title.trim() || kindLabel(finalKind, t),
          notes: description.trim() ? description : null,
          variableCostId: canAssignCategory(finalKind) ? variableCostId : null,
          icon,
          color,
        });
      } else {
        await createLedgerTransaction({
          date,
          amountCents: amountCentsForKind(kind, cents),
          accountId,
          kind,
          title: title.trim() ? title : kindLabel(kind, t),
          notes: description.trim() ? description : null,
          variableCostId: canAssignCategory(kind) ? variableCostId : null,
          icon,
          color,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const lockedKind = isEdit && row?.kind === 'buy_apply';

  return (
    <Modal
      open={open}
      wide
      title={isEdit ? t('transactions.editEntry') : t('transactions.newEntry')}
      onClose={onClose}
    >
      <div className="fh-form">
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
          {lockedKind ? (
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
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as typeof kind;
                  setKind(next);
                  setIcon(DEFAULT_KIND_ICON[next] ?? 'target');
                  setColor(DEFAULT_KIND_COLOR[next] ?? '#6366f1');
                  if (!canAssignCategory(next)) setVariableCostId(null);
                }}
              >
                <option value="expense">{t('transactions.kinds.expense')}</option>
                <option value="income">{t('transactions.kinds.income')}</option>
                <option value="adjustment">{t('transactions.kinds.adjustment')}</option>
              </select>
            </label>
          )}
          <label>
            {kind === 'adjustment' ? t('transactions.adjustmentAmount') : t('transactions.amountLabel')}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,34" />
          </label>
        </div>
        {canAssignCategory(kind) ? (
          <label>
            {t('common.category')}
            <VariableCostSuggestField costs={variableCosts} value={variableCostId} onChange={setVariableCostId} />
          </label>
        ) : null}
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
            <button type="button" className="fh-btn primary" onClick={save} disabled={!accountId || !amount.trim()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
