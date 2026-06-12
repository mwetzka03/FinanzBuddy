import { useEffect, useMemo, useState } from 'react';
import type { Account, AccountKind } from '../../lib/types';
import {
  effectiveAccountKind,
  isDepotAccount,
  isMainAccountCandidate,
  normalizeIbanInput,
} from '../../lib/accounts';
import { Checkbox } from '../common/Checkbox';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { createAccount, setDepotLinkedLedgerAccount, setMainAccount, updateAccount } from '../../tauri/api';
import { useLocale } from '../../i18n/LocaleProvider';

type AccountFormMode = 'create' | 'edit';

export function AccountFormModal({
  mode,
  open,
  account,
  allAccounts,
  onClose,
  onSaved,
  onError,
}: {
  mode: AccountFormMode;
  open: boolean;
  account?: Account | null;
  allAccounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [iban, setIban] = useState('');
  const [isLiquid, setIsLiquid] = useState(true);
  const [accountKind, setAccountKind] = useState<AccountKind>('standard');
  const [parentAccountId, setParentAccountId] = useState('');
  const [linkedLedgerAccountId, setLinkedLedgerAccountId] = useState('');
  const [isMain, setIsMain] = useState(false);
  const [mainConfirmOpen, setMainConfirmOpen] = useState(false);
  const [mainConfirmBusy, setMainConfirmBusy] = useState(false);

  const isDepot = mode === 'edit' && account ? isDepotAccount(account) : accountKind === 'depot';
  const isGiroEdit =
    mode === 'edit' && account != null && !isDepotAccount(account) && effectiveAccountKind(account) === 'standard';
  const currentMainAccount = useMemo(
    () => allAccounts.find((a) => a.isMain && isMainAccountCandidate(a)),
    [allAccounts],
  );
  const ledgerAccounts = useMemo(
    () => allAccounts.filter((a) => !isDepotAccount(a) && effectiveAccountKind(a) !== 'depot'),
    [allAccounts],
  );
  const oberspartopfAccounts = useMemo(
    () => allAccounts.filter((a) => effectiveAccountKind(a) === 'oberspartopf' && a.id !== account?.id),
    [allAccounts, account?.id],
  );

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && account) {
      setName(account.name);
      setIban(account.iban ?? '');
      setIsLiquid(account.isLiquid);
      setAccountKind(effectiveAccountKind(account));
      setParentAccountId(account.parentAccountId ?? '');
      setLinkedLedgerAccountId(account.linkedLedgerAccountId ?? '');
      setIsMain(account.isMain);
      return;
    }
    setName('');
    setIban('');
    setIsLiquid(true);
    setAccountKind('standard');
    setParentAccountId('');
    setLinkedLedgerAccountId('');
    setIsMain(false);
  }, [open, mode, account]);

  useEffect(() => {
    if (accountKind !== 'spartopf') {
      setParentAccountId('');
    }
  }, [accountKind]);

  async function persistAccount() {
    if (!name.trim()) return;
    if (mode === 'edit' && !account) return;
    if (isDepot && !linkedLedgerAccountId) {
      onError(t('accounts.linkedLedgerRequired'));
      return;
    }
    onError(null);
    const normalizedIban = iban.trim() ? normalizeIbanInput(iban.trim()) : null;
    if (mode === 'edit' && account) {
      await updateAccount({
        id: account.id,
        name: name.trim(),
        isLiquid,
        iban: normalizedIban,
        accountKind: isDepotAccount(account) ? undefined : accountKind,
        parentAccountId: accountKind === 'spartopf' ? parentAccountId || null : null,
      });
      if (isDepot && linkedLedgerAccountId && linkedLedgerAccountId !== (account.linkedLedgerAccountId ?? '')) {
        await setDepotLinkedLedgerAccount({ id: account.id, linkedLedgerAccountId });
      }
      if (isGiroEdit && isMain && !account.isMain) {
        await setMainAccount(account.id);
      }
    } else {
      await createAccount({
        name: name.trim(),
        isLiquid,
        accountKind,
        parentAccountId: accountKind === 'spartopf' && parentAccountId ? parentAccountId : null,
        iban: normalizedIban,
        linkedLedgerAccountId: isDepot ? linkedLedgerAccountId : null,
      });
    }
    await onSaved();
  }

  async function save() {
    if (!name.trim()) return;
    if (mode === 'edit' && account && isGiroEdit && isMain && !account.isMain && currentMainAccount) {
      setMainConfirmOpen(true);
      return;
    }
    try {
      await persistAccount();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmMainChange() {
    setMainConfirmBusy(true);
    onError(null);
    try {
      await persistAccount();
      setMainConfirmOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setMainConfirmBusy(false);
    }
  }

  const title = mode === 'edit' ? t('accounts.editAccount') : t('accounts.newAccount');
  const submitLabel = mode === 'edit' ? t('common.save') : t('common.create');

  return (
    <>
      <Modal open={open} title={title} onClose={onClose}>
        <div className="fh-form">
          <label>
            {t('common.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('accounts.namePlaceholder')} />
            {accountKind === 'spartopf' ? (
              <span className="fh-form-hint">{t('accounts.spartopfNameHint')}</span>
            ) : accountKind === 'oberspartopf' ? (
              <span className="fh-form-hint">{t('accounts.oberspartopfNameHint')}</span>
            ) : null}
          </label>
          {!isDepot ? (
            <label>
              {t('accounts.iban')}
              <input
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder={t('accounts.ibanPlaceholder')}
                autoCapitalize="characters"
              />
              <span className="fh-form-hint">
                {accountKind === 'oberspartopf' ? t('accounts.oberspartopfIbanHint') : t('accounts.ibanHint')}
              </span>
            </label>
          ) : null}
          <label>
            {t('accounts.accountKind')}
            <select
              value={accountKind}
              onChange={(e) => setAccountKind(e.target.value as AccountKind)}
              disabled={isDepot}
            >
              <option value="standard">{t('accounts.kindStandard')}</option>
              <option value="spartopf">{t('accounts.kindSpartopf')}</option>
              <option value="oberspartopf">{t('accounts.kindOberspartopf')}</option>
              {mode === 'create' ? <option value="depot">{t('accounts.kindDepot')}</option> : null}
              {isDepot ? <option value="depot">{t('accounts.kindDepot')}</option> : null}
            </select>
          </label>
          {accountKind === 'spartopf' && !isDepot ? (
            <label>
              {t('accounts.parentOberspartopf')}
              <select value={parentAccountId} onChange={(e) => setParentAccountId(e.target.value)}>
                <option value="">{t('accounts.parentOberspartopfNone')}</option>
                {oberspartopfAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="fh-form-hint">{t('accounts.parentOberspartopfHint')}</span>
            </label>
          ) : null}
          {isDepot ? (
            <label>
              {t('accounts.linkedLedgerAccount')}
              <select value={linkedLedgerAccountId} onChange={(e) => setLinkedLedgerAccountId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="fh-form-hint">{t('accounts.linkedLedgerAccountHint')}</span>
            </label>
          ) : null}
          {!isDepot ? (
            <Checkbox checked={isLiquid} onChange={setIsLiquid}>
              {t('accounts.liquid')}
            </Checkbox>
          ) : null}
          {isGiroEdit ? (
            <Checkbox
              checked={isMain}
              onChange={setIsMain}
              disabled={account?.isMain === true}
            >
              {t('accounts.mainAccount')}
            </Checkbox>
          ) : null}
          {isGiroEdit ? <span className="fh-form-hint">{t('accounts.mainAccountEditHint')}</span> : null}
          <div className="fh-form-actions">
            <button type="button" className="fh-btn ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <div className="fh-form-actions-right">
              <button
                type="button"
                className="fh-btn primary"
                onClick={save}
                disabled={!name.trim() || (isDepot && !linkedLedgerAccountId)}
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={mainConfirmOpen}
        message={
          currentMainAccount && account
            ? t('accounts.mainAccountChangeConfirm', {
                oldName: currentMainAccount.name,
                newName: name.trim() || account.name,
              })
            : t('common.confirmTitle')
        }
        busy={mainConfirmBusy}
        onConfirm={confirmMainChange}
        onCancel={() => setMainConfirmOpen(false)}
      />
    </>
  );
}
