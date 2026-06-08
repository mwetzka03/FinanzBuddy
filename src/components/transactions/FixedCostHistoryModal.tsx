import type { Account, FixedCost, LedgerTransaction } from '../../lib/types';
import { Modal } from '../common/Modal';
import { AmountTable } from '../data/AmountTable';
import { ThAmount, TdAmount } from '../data/AmountCells';
import { formatDisplayDate } from '../../lib/date';
import { formatExpenseEurFromCents } from '../../lib/money';
import { ledgerEntriesForFixedCost } from '../../lib/transactionList';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

const TABLE_COLS = '120px minmax(200px, 2fr) minmax(120px, 1fr) 120px';

type FixedCostHistoryModalProps = {
  open: boolean;
  fixedCost: FixedCost | null;
  ledger: LedgerTransaction[];
  accounts: Account[];
  onClose: () => void;
};

export function FixedCostHistoryModal({
  open,
  fixedCost,
  ledger,
  accounts,
  onClose,
}: FixedCostHistoryModalProps) {
  const ui = useUi();
  const { t } = useLocale();
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  if (!fixedCost) return null;

  const history = ledgerEntriesForFixedCost(fixedCost.id, ledger);

  return (
    <Modal open={open} wide title={fixedCost.name} onClose={onClose}>
      <p style={{ ...ui.sectionHint, marginTop: 0 }}>{t('fixedCosts.historyIntro')}</p>
      <AmountTable minWidth={420}>
        <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
          <div>{t('common.date')}</div>
          <div>{t('transactions.bookingText')}</div>
          <div>{t('transactions.accountLabel')}</div>
          <ThAmount col="amount">{t('common.amount')}</ThAmount>
        </div>
        {history.length === 0 ? (
          <div style={ui.emptyRow}>{t('fixedCosts.historyEmpty')}</div>
        ) : (
          history.map((tx) => (
            <div key={tx.id} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
              <div style={ui.tdMono}>{formatDisplayDate(tx.date)}</div>
              <div style={ui.cellStack}>
                <span>{tx.title}</span>
                {tx.notes ? <span style={{ ...ui.cellSub, fontSize: '0.85em' }}>{tx.notes}</span> : null}
              </div>
              <div style={{ color: ui.colors.textMuted, fontSize: 13 }}>
                {accountMap.get(tx.accountId ?? '') ?? '—'}
              </div>
              <TdAmount col="amount" amountCents={tx.amountCents}>
                {formatExpenseEurFromCents(Math.abs(tx.amountCents))}
              </TdAmount>
            </div>
          ))
        )}
      </AmountTable>
    </Modal>
  );
}
