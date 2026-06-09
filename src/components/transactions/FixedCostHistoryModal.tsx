import { useMemo, useState } from 'react';
import type { Account, FixedCost, LedgerTransaction } from '../../lib/types';
import { Modal } from '../common/Modal';
import { AmountTable } from '../data/AmountTable';
import { SortableTh, sortByState, type SortState } from '../data/tableSort';
import { TdAmount } from '../data/AmountCells';
import { TrashIconButton } from '../TrashIconButton';
import { formatDisplayDate } from '../../lib/date';
import { formatExpenseEurFromCents } from '../../lib/money';
import { ledgerEntriesForFixedCost } from '../../lib/transactionList';
import { unassignFixedCostTransaction } from '../../tauri/api';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

const TABLE_COLS = '120px minmax(280px, 2fr) minmax(140px, 1fr) 120px 52px';

type FixedCostHistoryModalProps = {
  open: boolean;
  fixedCost: FixedCost | null;
  ledger: LedgerTransaction[];
  accounts: Account[];
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
};

export function FixedCostHistoryModal({
  open,
  fixedCost,
  ledger,
  accounts,
  onClose,
  onChanged,
}: FixedCostHistoryModalProps) {
  const ui = useUi();
  const { t } = useLocale();
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  type HistorySortKey = 'date' | 'title' | 'account' | 'amount';
  const [sort, setSort] = useState<SortState<HistorySortKey>>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!fixedCost) return null;

  const history = ledgerEntriesForFixedCost(fixedCost.id, ledger);
  const sortedHistory = sortByState(history, sort, {
    date: (tx) => tx.date,
    title: (tx) => `${tx.title} ${tx.notes ?? ''}`,
    account: (tx) => accountMap.get(tx.accountId ?? '') ?? '',
    amount: (tx) => Math.abs(tx.amountCents),
  });

  async function removeAssignment(tx: LedgerTransaction) {
    setError(null);
    setBusyId(tx.id);
    try {
      await unassignFixedCostTransaction(tx.id);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} bleed title={fixedCost.name} onClose={onClose}>
      <p style={{ ...ui.sectionHint, marginTop: 0 }}>{t('fixedCosts.historyIntro')}</p>
      {error ? <p style={{ color: ui.colors.amountNegative, marginTop: 0 }}>{error}</p> : null}
      <AmountTable minWidth={720}>
        <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
          <SortableTh label={t('common.date')} sortKey="date" sort={sort} onSort={setSort} />
          <SortableTh label={t('transactions.bookingText')} sortKey="title" sort={sort} onSort={setSort} />
          <SortableTh label={t('transactions.accountLabel')} sortKey="account" sort={sort} onSort={setSort} />
          <SortableTh
            label={t('common.amount')}
            sortKey="amount"
            sort={sort}
            onSort={setSort}
            style={ui.thAmount}
            align="right"
          />
          <div />
        </div>
        {history.length === 0 ? (
          <div style={ui.emptyRow}>{t('fixedCosts.historyEmpty')}</div>
        ) : (
          sortedHistory.map((tx) => (
            <div key={tx.id} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
              <div style={ui.tdMono}>{formatDisplayDate(tx.date)}</div>
              <div style={ui.cellStack}>
                <span>{fixedCost.name}</span>
                {tx.notes?.trim() ? <span style={{ ...ui.cellSub, fontSize: '0.85em' }}>{tx.notes}</span> : null}
              </div>
              <div style={{ color: ui.colors.textMuted, fontSize: 13 }}>
                {accountMap.get(tx.accountId ?? '') ?? '—'}
              </div>
              <TdAmount col="amount" amountCents={tx.amountCents}>
                {formatExpenseEurFromCents(Math.abs(tx.amountCents))}
              </TdAmount>
              <TrashIconButton
                label={t('fixedCosts.removeAssignment')}
                disabled={busyId === tx.id}
                onClick={() => void removeAssignment(tx)}
              />
            </div>
          ))
        )}
      </AmountTable>
    </Modal>
  );
}
