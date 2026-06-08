import { useEffect, useMemo, useState } from 'react';
import type { Account, AccountKind } from '../../lib/types';
import { effectiveAccountKind, isDepotAccount, normalizeIbanInput } from '../../lib/accounts';
import { Checkbox } from '../common/Checkbox';
import { Modal } from '../common/Modal';
import { createAccount, updateAccount } from '../../tauri/api';
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

  const isDepot = mode === 'edit' && account ? isDepotAccount(account) : accountKind === 'depot';
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
      return;
    }
    setName('');
    setIban('');
    setIsLiquid(true);
    setAccountKind('standard');
    setParentAccountId('');
  }, [open, mode, account]);

  useEffect(() => {
    if (accountKind !== 'spartopf') {
      setParentAccountId('');
    }
  }, [accountKind]);

  async function save() {
    if (!name.trim()) return;
    onError(null);
    try {
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
      } else {
        await createAccount({
          name: name.trim(),
          isLiquid,
          accountKind,
          parentAccountId: accountKind === 'spartopf' && parentAccountId ? parentAccountId : null,
          iban: normalizedIban,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const title = mode === 'edit' ? t('accounts.editAccount') : t('accounts.newAccount');
  const submitLabel = mode === 'edit' ? t('common.save') : t('common.create');

  return (
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
        {!isDepot ? (
          <Checkbox checked={isLiquid} onChange={setIsLiquid}>
            {t('accounts.liquid')}
          </Checkbox>
        ) : null}
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={save} disabled={!name.trim()}>
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
