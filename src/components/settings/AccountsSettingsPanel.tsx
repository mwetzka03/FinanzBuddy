import { useEffect, useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import type { Account } from '../../lib/types';
import { accountKindLabel, buildAccountTreeRows, isMainAccountCandidate } from '../../lib/accounts';
import { AddEntryButton } from '../common/AddEntryButton';
import { AccountFormModal } from './AccountFormModal';
import { listAccounts, setMainAccount } from '../../tauri/api';
import { useTablePagination, TablePaginationBar } from '../data/tablePagination';
import { useUi } from '../../lib/ui';
import { useLocale } from '../../i18n/LocaleProvider';
import { EditIconButton } from '../EditIconButton';

const ACCOUNT_COLS = '1fr 160px 90px 48px';

export function AccountsSettingsPanel() {
  const ui = useUi();
  const { t } = useLocale();
  const [rows, setRows] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const treeRows = useMemo(() => buildAccountTreeRows(rows), [rows]);
  const pagination = useTablePagination(treeRows);
  const mainAccountCandidates = useMemo(() => rows.filter(isMainAccountCandidate), [rows]);
  const mainAccountId = useMemo(() => rows.find((a) => a.isMain)?.id ?? '', [rows]);

  async function refresh() {
    setRows(await listAccounts());
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onSetMain(id: string) {
    setError(null);
    await setMainAccount(id);
    await refresh();
  }

  return (
    <article className="fh-panel fh-settings-pref fh-settings-pref-wide">
      <header className="fh-panel-head fh-panel-head--split">
        <div className="fh-panel-head-title">
          <Landmark size={18} aria-hidden />
          <h2>{t('settings.accounts.title')}</h2>
        </div>
        <AddEntryButton label={t('accounts.newAccount')} onClick={() => setCreateModalOpen(true)} />
      </header>
      <p className="fh-panel-desc">{t('settings.accounts.desc')}</p>

      {error ? <div className="fh-bank-import-result fh-bank-import-result--error">{error}</div> : null}

      <label style={{ ...ui.field, maxWidth: 360, marginBottom: 16, display: 'flex' }}>
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
            <div>{t('common.name')}</div>
            <div>{t('accounts.accountKind')}</div>
            <div>{t('accounts.liquid')}</div>
            <div />
          </div>
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
          />
          {rows.length === 0 ? (
            <div style={ui.emptyRow}>{t('common.noAccountsYet')}</div>
          ) : (
            pagination.pageItems.map(({ account: a, depth }) => (
              <div key={a.id} style={{ ...ui.tableRow, gridTemplateColumns: ACCOUNT_COLS }}>
                <div style={{ ...ui.cellStack, paddingLeft: depth * 18 }}>
                  <span>
                    {a.name}
                    {a.isMain ? t('accounts.mainAccountSuffix') : ''}
                  </span>
                  {a.iban ? (
                    <span style={{ ...ui.cellSub, fontSize: '0.85em' }}>{a.iban}</span>
                  ) : null}
                </div>
                <div>{accountKindLabel(a, t)}</div>
                <div style={{ color: ui.colors.textMuted, fontSize: 13 }}>
                  {a.isLiquid ? t('accounts.liquid') : t('accounts.notLiquid')}
                </div>
                <div style={{ ...ui.tdActions, justifyContent: 'flex-end' }}>
                  <EditIconButton label={t('accounts.editAccount')} onClick={() => setEditAccount(a)} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <AccountFormModal
        mode="create"
        open={createModalOpen}
        allAccounts={rows}
        onClose={() => setCreateModalOpen(false)}
        onSaved={async () => {
          setCreateModalOpen(false);
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
    </article>
  );
}
