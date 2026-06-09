import { useEffect, useMemo, useState } from 'react';
import type { BuyItem, IsoMonth } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { ColorPicker, EntityIconBadge, IconPicker } from '../components/common/AppIcon';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { formatDisplayDate, formatDisplayMonth, toIsoMonth } from '../lib/date';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, parseEurToCents } from '../lib/money';
import {
  applyBuyItem,
  createBuyItem,
  deleteBuyItem,
  listBuyItems,
  unapplyBuyItem,
  updateBuyItem,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { MonthInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';

const TABLE_COLS = '48px 48px minmax(200px, 2.5fr) 120px 120px 72px';

export function BuyListPage() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<BuyItem[]>([]);
  type BuySortKey = 'status' | 'name' | 'amount' | 'month';
  const [sort, setSort] = useState<SortState<BuySortKey>>(null);
  const sortedRows = useMemo(
    () =>
      sortByState(rows, sort, {
        status: (r) => (r.status === 'applied' ? 1 : 0),
        name: (r) => r.name,
        amount: (r) => r.amountCents,
        month: (r) => r.plannedMonth ?? '',
      }),
    [rows, sort],
  );
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function refresh() {
    try {
      setRows(await listBuyItems());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function openCreate() {
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(item: BuyItem) {
    setEditingId(item.id);
    setModalOpen(true);
  }

  async function onToggle(item: BuyItem) {
    setError(null);
    if (item.status === 'parked') await applyBuyItem(item.id);
    else await unapplyBuyItem(item.id);
    await refresh();
  }

  async function onDelete(item: BuyItem) {
    setError(null);
    await deleteBuyItem(item.id);
    await refresh();
  }

  return (
    <PageShell
      title={t('buyList.title')}
      intro={t('buyList.intro')}
      error={error}
      headerActions={<AddEntryButton label={t('buyList.newEntry')} onClick={openCreate} />}
    >
      <ListPanel hint={t('buyList.listHint')}>
        <AmountTable>
          <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
            <div />
            <SortableTh label="Real" sortKey="status" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('common.name')} sortKey="name" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh
              label={t('common.amount')}
              sortKey="amount"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="right"
            />
            <SortableTh label={t('common.month')} sortKey="month" sort={sort} onSort={setSort} style={ui.thMono} />
            <div />
          </div>
          {rows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.none')}</div>
          ) : (
            sortedRows.map((r) => (
              <div key={r.id} style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                <EntityIconBadge icon={r.icon} color={r.color} size={20} />
                <div style={ui.tdReal}>
                  <Checkbox
                    className="fh-checkbox--solo"
                    checked={r.status === 'applied'}
                    onChange={() => onToggle(r)}
                    title={r.status === 'parked' ? t('buyList.applyToday') : t('buyList.unapply')}
                  />
                </div>
                <div style={{ ...ui.cellStack, ...ui.tdName }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  {r.description ? <div style={ui.cellSub}>{r.description}</div> : null}
                  {r.status === 'applied' && r.appliedDate ? (
                    <div style={ui.cellSub}>{t('buyList.bookedOn', { date: formatDisplayDate(r.appliedDate) })}</div>
                  ) : null}
                </div>
                <TdAmount col="cost" amountCents={-r.amountCents}>
                  {formatExpenseEurFromCents(r.amountCents)}
                </TdAmount>
                <div style={ui.tdMono}>{r.plannedMonth ? formatDisplayMonth(r.plannedMonth) : t('common.none')}</div>
                <div style={ui.tdActions}>
                  {r.status === 'parked' && (
                    <>
                      <EditIconButton label={t('common.edit')} onClick={() => openEdit(r)} />
                      <TrashIconButton label={t('common.delete')} onClick={() => onDelete(r)} />
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </AmountTable>
      </ListPanel>

      <BuyItemModal
        open={modalOpen}
        itemId={editingId}
        rows={rows}
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

function BuyItemModal({
  open,
  itemId,
  rows,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  itemId: string | null;
  rows: BuyItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const existing = itemId ? rows.find((r) => r.id === itemId) : undefined;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [plannedMonth, setPlannedMonth] = useState<IsoMonth>(() => toIsoMonth(new Date()));
  const [icon, setIcon] = useState('shop');
  const [color, setColor] = useState('#ec4899');

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setAmount(existing ? (existing.amountCents / 100).toFixed(2).replace('.', ',') : '');
    setPlannedMonth(existing?.plannedMonth ?? toIsoMonth(new Date()));
    setIcon(existing?.icon ?? 'shop');
    setColor(existing?.color ?? '#ec4899');
  }, [open, existing]);

  async function save() {
    if (!name.trim() || !amount.trim()) return;
    onError(null);
    try {
      if (itemId) {
        await updateBuyItem({
          id: itemId,
          name,
          description: description.trim() ? description : null,
          amountCents: parseEurToCents(amount),
          plannedMonth,
          icon,
          color,
        });
      } else {
        await createBuyItem({
          name,
          description: description.trim() ? description : null,
          amountCents: parseEurToCents(amount),
          plannedMonth,
          icon,
          color,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={itemId ? t('buyList.editEntry') : t('buyList.newEntry')} onClose={onClose}>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('buyList.namePlaceholder')} />
          <OptionalDescriptionInput value={description} onChange={setDescription} />
        </label>
        <div className="fh-form-row">
          <label>
            {t('common.amount')} (EUR)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="999,99" />
          </label>
          <label>
            {t('common.month')}
            <MonthInput value={plannedMonth} onChange={setPlannedMonth} />
          </label>
        </div>
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
              {itemId ? t('common.save') : t('buyList.parked')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
