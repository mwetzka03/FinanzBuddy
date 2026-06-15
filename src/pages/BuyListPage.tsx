import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleOff, Plus } from 'lucide-react';
import type { BuyItem, BuyItemGroup, IsoMonth, LedgerTransaction } from '../lib/types';
import { AddEntryButton } from '../components/common/AddEntryButton';
import { Checkbox } from '../components/common/Checkbox';
import { ColorPicker, EntityIconBadge, IconPicker } from '../components/common/AppIcon';
import { Modal } from '../components/common/Modal';
import { AmountTable } from '../components/data/AmountTable';
import { useTablePagination, TablePaginationBar } from '../components/data/tablePagination';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { formatDisplayDate, formatDisplayMonth, toIsoMonth } from '../lib/date';
import { useLocale } from '../i18n/LocaleProvider';
import { formatExpenseEurFromCents, parseEurToCents } from '../lib/money';
import {
  applyBuyItem,
  applyBuyItemGroup,
  createBuyItem,
  createBuyItemGroup,
  deleteBuyItem,
  deleteBuyItemGroup,
  listBuyItemGroups,
  listBuyItems,
  listLedgerTransactions,
  unapplyBuyItem,
  updateBuyItem,
  updateBuyItemGroup,
} from '../tauri/api';
import { useUi } from '../lib/ui';
import { ListPanel } from '../components/layout/ListPanel';
import { PageShell } from '../components/layout/PageShell';
import { MonthInput } from '../components/DateInput';
import { EditIconButton } from '../components/EditIconButton';
import { TrashIconButton } from '../components/TrashIconButton';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';
import { LinkifiedText } from '../components/common/LinkifiedText';

const TABLE_COLS = '48px 48px minmax(200px, 2.5fr) 120px 120px 120px 72px';

type ListRow =
  | { kind: 'item'; item: BuyItem }
  | {
      kind: 'group';
      group: BuyItemGroup;
      totalAmountCents: number;
      openAmountCents: number;
      allApplied: boolean;
      anyApplied: boolean;
    };

export function BuyListPage() {
  const ui = useUi();
  const { t } = useLocale();
  const location = useLocation();
  const [rows, setRows] = useState<BuyItem[]>([]);
  const [groups, setGroups] = useState<BuyItemGroup[]>([]);
  const [expenseOptions, setExpenseOptions] = useState<LedgerTransaction[]>([]);
  const [pendingApply, setPendingApply] = useState<{ kind: 'item' | 'group'; id: string } | null>(null);
  const [linkLedgerId, setLinkLedgerId] = useState('');
  type BuySortKey = 'status' | 'name' | 'totalAmount' | 'openAmount' | 'month';
  const [sort, setSort] = useState<SortState<BuySortKey>>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupDetailId, setGroupDetailId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const listRows = useMemo((): ListRow[] => {
    const out: ListRow[] = [];
    for (const group of groups) {
      const members = rows.filter((r) => r.groupId === group.id);
      if (members.length === 0) continue;
      const totalAmountCents = members.reduce((sum, m) => sum + m.amountCents, 0);
      const openAmountCents = members
        .filter((m) => m.status === 'parked')
        .reduce((sum, m) => sum + m.amountCents, 0);
      if (openAmountCents === 0 && members.every((m) => m.status === 'applied')) {
        out.push({
          kind: 'group',
          group,
          totalAmountCents,
          openAmountCents: 0,
          allApplied: true,
          anyApplied: true,
        });
        continue;
      }
      if (openAmountCents === 0) continue;
      out.push({
        kind: 'group',
        group,
        totalAmountCents,
        openAmountCents,
        allApplied: false,
        anyApplied: members.some((m) => m.status === 'applied'),
      });
    }
    for (const item of rows) {
      if (!item.groupId) out.push({ kind: 'item', item });
    }
    return out;
  }, [rows, groups]);

  const sortedRows = useMemo(
    () =>
      sortByState(listRows, sort, {
        status: (r) => {
          if (r.kind === 'group') return r.allApplied ? 1 : 0;
          return r.item.status === 'applied' ? 1 : 0;
        },
        name: (r) => (r.kind === 'group' ? r.group.name : r.item.name),
        totalAmount: (r) => (r.kind === 'group' ? r.totalAmountCents : r.item.amountCents),
        openAmount: (r) => (r.kind === 'group' ? r.openAmountCents : r.item.amountCents),
        month: (r) =>
          r.kind === 'group' ? r.group.plannedMonth ?? '' : r.item.plannedMonth ?? '',
      }),
    [listRows, sort],
  );
  const pagination = useTablePagination(sortedRows);

  async function refresh() {
    try {
      const [items, groupRows] = await Promise.all([listBuyItems(), listBuyItemGroups()]);
      setRows(items);
      setGroups(groupRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    listLedgerTransactions({})
      .then((txs) => setExpenseOptions(txs.filter((tx) => tx.kind === 'expense')))
      .catch(() => setExpenseOptions([]));
  }, []);

  useEffect(() => {
    const groupId = (location.state as { groupId?: string } | null)?.groupId;
    if (groupId) setGroupDetailId(groupId);
  }, [location.state]);

  function openCreate() {
    setEditingId(null);
    setModalOpen(true);
  }

  function openCreateGroup() {
    setEditingGroupId(null);
    setGroupModalOpen(true);
  }

  function openEdit(item: BuyItem) {
    setEditingId(item.id);
    setModalOpen(true);
  }

  function openEditGroup(group: BuyItemGroup) {
    setEditingGroupId(group.id);
    setGroupModalOpen(true);
  }

  async function onToggle(item: BuyItem) {
    setError(null);
    if (item.status === 'parked') {
      setLinkLedgerId('');
      setPendingApply({ kind: 'item', id: item.id });
      return;
    }
    await unapplyBuyItem(item.id);
    await refresh();
  }

  async function onToggleGroup(group: BuyItemGroup) {
    setError(null);
    const members = rows.filter((r) => r.groupId === group.id);
    const allApplied = members.every((m) => m.status === 'applied');
    if (allApplied) {
      for (const member of members) {
        if (member.status === 'applied') await unapplyBuyItem(member.id);
      }
      await refresh();
      return;
    }
    setLinkLedgerId('');
    setPendingApply({ kind: 'group', id: group.id });
  }

  async function confirmApply(mode: 'prognosis' | 'link') {
    if (!pendingApply) return;
    setError(null);
    try {
      const ledgerId = mode === 'link' ? linkLedgerId || null : null;
      if (pendingApply.kind === 'item') {
        await applyBuyItem(pendingApply.id, ledgerId);
      } else {
        await applyBuyItemGroup(pendingApply.id, ledgerId);
      }
      setPendingApply(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDelete(item: BuyItem) {
    setError(null);
    await deleteBuyItem(item.id);
    await refresh();
  }

  async function onDeleteGroup(group: BuyItemGroup) {
    setError(null);
    await deleteBuyItemGroup(group.id);
    await refresh();
  }

  const activeGroup = groupDetailId ? groups.find((g) => g.id === groupDetailId) ?? null : null;
  const activeGroupMembers = activeGroup ? rows.filter((r) => r.groupId === activeGroup.id) : [];

  return (
    <PageShell
      title={t('buyList.title')}
      intro={t('buyList.intro')}
      error={error}
      onErrorDismiss={() => setError(null)}
      headerActions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <AddEntryButton label={t('buyList.newEntry')} onClick={openCreate} />
          <button type="button" className="fh-btn ghost" onClick={openCreateGroup}>
            {t('buyList.newGroup')}
          </button>
        </div>
      }
    >
      <ListPanel hint={t('buyList.listHint')}>
        <AmountTable>
          <div className="fh-table-head" style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
            <div />
            <SortableTh label="Real" sortKey="status" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh label={t('common.name')} sortKey="name" sort={sort} onSort={setSort} style={ui.thName} />
            <SortableTh
              label={t('buyList.totalAmount')}
              sortKey="totalAmount"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="cost"
            />
            <SortableTh
              label={t('buyList.openAmount')}
              sortKey="openAmount"
              sort={sort}
              onSort={setSort}
              style={ui.thAmount}
              align="center"
              amountCol="cost"
            />
            <SortableTh label={t('common.month')} sortKey="month" sort={sort} onSort={setSort} style={ui.thMono} />
            <div />
          </div>
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
          {sortedRows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.none')}</div>
          ) : (
            pagination.pageItems.map((r) => {
              if (r.kind === 'group') {
                const { group, totalAmountCents, openAmountCents, allApplied } = r;
                return (
                  <div
                    key={`group-${group.id}`}
                    className="fh-table-row"
                    style={{
                      ...ui.tableRow,
                      ...ui.tableRowAccent(group.color),
                      gridTemplateColumns: TABLE_COLS,
                    }}
                  >
                    <EntityIconBadge icon={group.icon} color={group.color} size={20} />
                    <div style={ui.tdReal}>
                      <Checkbox
                        className="fh-checkbox--solo"
                        checked={allApplied}
                        onChange={() => void onToggleGroup(group)}
                        title={allApplied ? t('buyList.unapply') : t('buyList.applyToday')}
                      />
                    </div>
                    <div style={{ ...ui.cellStack, ...ui.tdName }}>
                      <button
                        type="button"
                        className="fh-link-button"
                        style={{ fontWeight: 600, textAlign: 'left', color: group.color }}
                        onClick={() => setGroupDetailId(group.id)}
                      >
                        {group.name}
                      </button>
                      {group.description ? <div style={ui.cellSub}><LinkifiedText text={group.description} /></div> : null}
                    </div>
                    <TdAmount col="cost" amountCents={-totalAmountCents}>
                      {formatExpenseEurFromCents(totalAmountCents)}
                    </TdAmount>
                    <TdAmount col="cost" amountCents={-openAmountCents}>
                      {formatExpenseEurFromCents(openAmountCents)}
                    </TdAmount>
                    <div style={ui.tdMono}>
                      {group.plannedMonth ? formatDisplayMonth(group.plannedMonth) : t('buyList.indefinitePeriod')}
                    </div>
                    <div style={ui.tdActions}>
                      <EditIconButton label={t('common.edit')} onClick={() => openEditGroup(group)} />
                      <TrashIconButton label={t('common.delete')} onClick={() => void onDeleteGroup(group)} />
                    </div>
                  </div>
                );
              }

              const item = r.item;
              return (
                <div key={item.id} className="fh-table-row" style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                  <EntityIconBadge icon={item.icon} color={item.color} size={20} />
                  <div style={ui.tdReal}>
                    <Checkbox
                      className="fh-checkbox--solo"
                      checked={item.status === 'applied'}
                      onChange={() => void onToggle(item)}
                      title={item.status === 'parked' ? t('buyList.applyToday') : t('buyList.unapply')}
                    />
                  </div>
                  <div style={{ ...ui.cellStack, ...ui.tdName }}>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    {item.description ? <div style={ui.cellSub}><LinkifiedText text={item.description} /></div> : null}
                    {item.status === 'applied' && item.appliedDate ? (
                      <div style={ui.cellSub}>{t('buyList.bookedOn', { date: formatDisplayDate(item.appliedDate) })}</div>
                    ) : null}
                  </div>
                  <TdAmount col="cost" amountCents={-item.amountCents}>
                    {formatExpenseEurFromCents(item.amountCents)}
                  </TdAmount>
                  <TdAmount col="cost" amountCents={-item.amountCents}>
                    {formatExpenseEurFromCents(item.amountCents)}
                  </TdAmount>
                  <div style={ui.tdMono}>
                    {item.plannedMonth ? formatDisplayMonth(item.plannedMonth) : t('buyList.indefinitePeriod')}
                  </div>
                  <div style={ui.tdActions}>
                    {item.status === 'parked' && (
                      <>
                        <EditIconButton label={t('common.edit')} onClick={() => openEdit(item)} />
                        <TrashIconButton label={t('common.delete')} onClick={() => void onDelete(item)} />
                      </>
                    )}
                  </div>
                </div>
              );
            })
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

      <BuyItemGroupModal
        open={groupModalOpen}
        groupId={editingGroupId}
        rows={rows}
        groups={groups}
        onClose={() => setGroupModalOpen(false)}
        onSaved={async () => {
          setGroupModalOpen(false);
          await refresh();
        }}
        onError={setError}
      />

      {activeGroup ? (
        <BuyItemGroupDetailModal
          open={!!activeGroup}
          group={activeGroup}
          members={activeGroupMembers}
          unassignedItems={rows.filter((r) => !r.groupId)}
          onClose={() => setGroupDetailId(null)}
          onRefresh={refresh}
          onError={setError}
          onMemberRealToggle={(item) => {
            if (item.status === 'parked') {
              setLinkLedgerId('');
              setPendingApply({ kind: 'item', id: item.id });
              return;
            }
            void unapplyBuyItem(item.id).then(refresh).catch((e) => setError(e instanceof Error ? e.message : String(e)));
          }}
        />
      ) : null}

      <Modal
        open={!!pendingApply}
        title={t('buyList.applyTitle')}
        onClose={() => setPendingApply(null)}
      >
        <div className="fh-form">
          <p className="fh-form-hint">{t('buyList.applyHint')}</p>
          <label>
            {t('buyList.linkExpenseOptional')}
            <select value={linkLedgerId} onChange={(e) => setLinkLedgerId(e.target.value)}>
              <option value="">{t('buyList.applyPrognosis')}</option>
              {expenseOptions.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {formatDisplayDate(tx.date)} — {tx.title} ({formatExpenseEurFromCents(Math.abs(tx.amountCents))})
                </option>
              ))}
            </select>
          </label>
          <div className="fh-form-actions">
            <button type="button" className="fh-btn ghost" onClick={() => setPendingApply(null)}>
              {t('common.cancel')}
            </button>
            <div className="fh-form-actions-right">
              <button type="button" className="fh-btn primary" onClick={() => void confirmApply(linkLedgerId ? 'link' : 'prognosis')}>
                {linkLedgerId ? t('buyList.applyLinked') : t('buyList.applyPrognosis')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
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
  const [indefinitePeriod, setIndefinitePeriod] = useState(false);
  const [icon, setIcon] = useState('shop');
  const [color, setColor] = useState('#ec4899');

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setAmount(existing ? (existing.amountCents / 100).toFixed(2).replace('.', ',') : '');
    setIndefinitePeriod(!existing?.plannedMonth);
    setPlannedMonth(existing?.plannedMonth ?? toIsoMonth(new Date()));
    setIcon(existing?.icon ?? 'shop');
    setColor(existing?.color ?? '#ec4899');
  }, [open, existing]);

  async function save() {
    if (!name.trim() || !amount.trim()) return;
    onError(null);
    const month = indefinitePeriod ? null : plannedMonth;
    try {
      if (itemId) {
        await updateBuyItem({
          id: itemId,
          name,
          description: description.trim() ? description : null,
          amountCents: parseEurToCents(amount),
          plannedMonth: month,
          icon,
          color,
          groupId: existing?.groupId ?? null,
        });
      } else {
        await createBuyItem({
          name,
          description: description.trim() ? description : null,
          amountCents: parseEurToCents(amount),
          plannedMonth: month,
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
          {!indefinitePeriod ? (
            <label>
              {t('common.month')}
              <MonthInput value={plannedMonth} onChange={setPlannedMonth} />
            </label>
          ) : null}
        </div>
        <Checkbox checked={indefinitePeriod} onChange={setIndefinitePeriod} hint={t('buyList.indefinitePeriodHint')}>
          {t('buyList.indefinitePeriod')}
        </Checkbox>
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
            <button type="button" className="fh-btn primary" onClick={() => void save()} disabled={!name.trim() || !amount.trim()}>
              {itemId ? t('common.save') : t('buyList.parked')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BuyItemGroupModal({
  open,
  groupId,
  rows,
  groups,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  groupId: string | null;
  rows: BuyItem[];
  groups: BuyItemGroup[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const ui = useUi();
  const existing = groupId ? groups.find((g) => g.id === groupId) : undefined;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [plannedMonth, setPlannedMonth] = useState<IsoMonth>(() => toIsoMonth(new Date()));
  const [indefinitePeriod, setIndefinitePeriod] = useState(false);
  const [icon, setIcon] = useState('shop');
  const [color, setColor] = useState('#ec4899');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [pickerItemId, setPickerItemId] = useState('');

  const availableItems = useMemo(() => {
    const assignedElsewhere = new Set(
      rows.filter((r) => r.groupId && r.groupId !== groupId).map((r) => r.id),
    );
    const currentMembers = groupId ? rows.filter((r) => r.groupId === groupId).map((r) => r.id) : [];
    return rows.filter(
      (r) =>
        !r.groupId &&
        !assignedElsewhere.has(r.id) &&
        !selectedItemIds.includes(r.id) &&
        !currentMembers.includes(r.id),
    );
  }, [rows, groupId, selectedItemIds]);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setIndefinitePeriod(!existing?.plannedMonth);
    setPlannedMonth(existing?.plannedMonth ?? toIsoMonth(new Date()));
    setIcon(existing?.icon ?? 'shop');
    setColor(existing?.color ?? '#ec4899');
    setSelectedItemIds([]);
    setPickerItemId('');
  }, [open, existing]);

  function addSelectedItem() {
    if (!pickerItemId || selectedItemIds.includes(pickerItemId)) return;
    setSelectedItemIds((prev) => [...prev, pickerItemId]);
    setPickerItemId('');
  }

  async function save() {
    if (!name.trim()) return;
    onError(null);
    const month = indefinitePeriod ? null : plannedMonth;
    const memberIds = [
      ...selectedItemIds,
      ...(groupId ? rows.filter((r) => r.groupId === groupId).map((r) => r.id) : []),
    ];
    try {
      if (groupId) {
        await updateBuyItemGroup({
          id: groupId,
          name,
          description: description.trim() ? description : null,
          plannedMonth: month,
          icon,
          color,
          itemIds: memberIds,
        });
      } else {
        await createBuyItemGroup({
          name,
          description: description.trim() ? description : null,
          plannedMonth: month,
          icon,
          color,
          itemIds: selectedItemIds,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={groupId ? t('buyList.editGroup') : t('buyList.newGroup')} onClose={onClose} wide>
      <div className="fh-form">
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('buyList.groupNamePlaceholder')} />
          <OptionalDescriptionInput value={description} onChange={setDescription} />
        </label>
        {!indefinitePeriod ? (
          <label>
            {t('common.month')}
            <MonthInput value={plannedMonth} onChange={setPlannedMonth} />
          </label>
        ) : null}
        <Checkbox checked={indefinitePeriod} onChange={setIndefinitePeriod} hint={t('buyList.indefinitePeriodHint')}>
          {t('buyList.indefinitePeriod')}
        </Checkbox>
        <label>
          {t('common.icon')}
          <IconPicker value={icon} onChange={setIcon} />
        </label>
        <label>
          {t('common.color')}
          <ColorPicker value={color} onChange={setColor} />
        </label>
        <div className="fh-form-block">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('buyList.addExistingEntry')}</div>
          <div className="fh-form-row fh-form-row--align-end">
            <label className="fh-form-row-grow">
              {t('buyList.addMember')}
              <select value={pickerItemId} onChange={(e) => setPickerItemId(e.target.value)}>
                <option value="">–</option>
                {availableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({formatExpenseEurFromCents(item.amountCents)})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="fh-btn ghost fh-btn--icon" onClick={addSelectedItem} disabled={!pickerItemId} title={t('buyList.addMember')}>
              <Plus size={18} aria-hidden />
            </button>
          </div>
          {selectedItemIds.length > 0 ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {selectedItemIds.map((id) => {
                const item = rows.find((r) => r.id === id);
                if (!item) return null;
                return (
                  <li key={id} style={{ marginBottom: 4 }}>
                    {item.name} ({formatExpenseEurFromCents(item.amountCents)})
                    <button
                      type="button"
                      className="fh-link-button"
                      style={{ marginLeft: 8 }}
                      onClick={() => setSelectedItemIds((prev) => prev.filter((x) => x !== id))}
                    >
                      {t('common.delete')}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {groupId ? (
            <div style={{ marginTop: 12, fontSize: 13, color: ui.colors.textMuted }}>
              {rows.filter((r) => r.groupId === groupId).length} {t('buyList.groupMembers').toLowerCase()}
            </div>
          ) : null}
        </div>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={() => void save()} disabled={!name.trim()}>
              {groupId ? t('common.save') : t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BuyItemGroupDetailModal({
  open,
  group,
  members,
  unassignedItems,
  onClose,
  onRefresh,
  onError,
  onMemberRealToggle,
}: {
  open: boolean;
  group: BuyItemGroup;
  members: BuyItem[];
  unassignedItems: BuyItem[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onMemberRealToggle: (item: BuyItem) => void;
}) {
  const { t } = useLocale();
  const ui = useUi();
  const [addItemId, setAddItemId] = useState('');
  const [editMember, setEditMember] = useState<BuyItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState('');

  useEffect(() => {
    if (!editMember) return;
    setEditName(editMember.name);
    setEditAmount((editMember.amountCents / 100).toFixed(2).replace('.', ','));
  }, [editMember]);

  async function addMember() {
    if (!addItemId) return;
    onError(null);
    try {
      await updateBuyItemGroup({
        id: group.id,
        name: group.name,
        description: group.description,
        plannedMonth: group.plannedMonth,
        icon: group.icon,
        color: group.color,
        itemIds: [...members.map((m) => m.id), addItemId],
      });
      setAddItemId('');
      await onRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeMember(item: BuyItem) {
    onError(null);
    try {
      await updateBuyItem({
        id: item.id,
        name: item.name,
        description: item.description,
        amountCents: item.amountCents,
        plannedMonth: item.plannedMonth,
        icon: item.icon,
        color: item.color,
        groupId: null,
      });
      await onRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveMember() {
    if (!editMember || !editName.trim() || !editAmount.trim()) return;
    onError(null);
    try {
      await updateBuyItem({
        id: editMember.id,
        name: editName,
        description: editMember.description,
        amountCents: parseEurToCents(editAmount),
        plannedMonth: editMember.plannedMonth,
        icon: editMember.icon,
        color: editMember.color,
        groupId: group.id,
      });
      setEditMember(null);
      await onRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteMember(item: BuyItem) {
    onError(null);
    try {
      await deleteBuyItem(item.id);
      setEditMember(null);
      await onRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal open={open} title={`${t('buyList.groupDetail')}: ${group.name}`} onClose={onClose} bleed>
      <div className="fh-form">
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('buyList.groupMembers')}</div>
        {members.length === 0 ? (
          <div style={{ color: ui.colors.textMuted, marginBottom: 12 }}>{t('buyList.noMembers')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            {members.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 1fr 120px 104px',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: ui.colors.bgMuted,
                }}
              >
                <div>
                  <Checkbox
                    className="fh-checkbox--solo"
                    checked={member.status === 'applied'}
                    onChange={() => onMemberRealToggle(member)}
                    title={member.status === 'parked' ? t('buyList.applyToday') : t('buyList.unapply')}
                  />
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{member.name}</div>
                  {member.description ? <div style={ui.cellSub}><LinkifiedText text={member.description} /></div> : null}
                  {member.status === 'applied' && member.appliedDate ? (
                    <div style={ui.cellSub}>{t('buyList.bookedOn', { date: formatDisplayDate(member.appliedDate) })}</div>
                  ) : null}
                </div>
                <div style={{ textAlign: 'right' }}>{formatExpenseEurFromCents(member.amountCents)}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', minHeight: 32 }}>
                  {member.status === 'parked' ? (
                    <>
                      <EditIconButton label={t('common.edit')} onClick={() => setEditMember(member)} />
                      <TrashIconButton label={t('common.delete')} onClick={() => void deleteMember(member)} />
                      <RemoveFromGroupIconButton label={t('buyList.removeFromGroup')} onClick={() => void removeMember(member)} />
                    </>
                  ) : (
                    <span style={{ width: 1, height: 1, visibility: 'hidden' }} aria-hidden />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {unassignedItems.length > 0 ? (
          <div className="fh-form-row fh-form-row--align-end" style={{ marginBottom: 12 }}>
            <label className="fh-form-row-grow">
              {t('buyList.addMember')}
              <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)}>
                <option value="">–</option>
                {unassignedItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({formatExpenseEurFromCents(item.amountCents)})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="fh-btn primary" onClick={() => void addMember()} disabled={!addItemId}>
              {t('common.add')}
            </button>
          </div>
        ) : null}

        {editMember ? (
          <div style={{ borderTop: `1px solid ${ui.colors.border}`, paddingTop: 12 }}>
            <div className="fh-form-row">
              <label>
                {t('common.name')}
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <label>
                {t('common.amount')} (EUR)
                <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
              </label>
            </div>
            <div className="fh-form-actions">
              <button type="button" className="fh-btn ghost" onClick={() => setEditMember(null)}>
                {t('common.cancel')}
              </button>
              <div className="fh-form-actions-right">
                <button type="button" className="fh-btn primary" onClick={() => void saveMember()}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function RemoveFromGroupIconButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const { colors } = useUi();

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 0,
        flexShrink: 0,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        background: colors.bgMuted,
        color: colors.textMuted,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = colors.accentDark;
        e.currentTarget.style.borderColor = colors.accent;
        e.currentTarget.style.background = colors.accentSoft;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.textMuted;
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.background = colors.bgMuted;
      }}
    >
      <CircleOff size={16} aria-hidden="true" />
    </button>
  );
}
