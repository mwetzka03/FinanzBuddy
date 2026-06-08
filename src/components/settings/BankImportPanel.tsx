import { useEffect, useMemo, useState } from 'react';
import { FileUp, Landmark } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  Account,
  BankImportPreview,
  BankImportResult,
  ChildBalanceInput,
  PrimaryIncomeImportInput,
} from '../../lib/types';
import { useLocale } from '../../i18n/LocaleProvider';
import { getDashboardSettings, importBankExport, listAccounts, previewBankExport } from '../../tauri/api';
import { isBankImportAccount, isOberspartopf, isSavingsPotAccount } from '../../lib/accounts';
import { Modal } from '../common/Modal';
import { formatEurFromCents, parseEurToCents } from '../../lib/money';
import { isoToday } from '../../lib/date';

type Step = 'balance' | 'primaryIncome';

export function BankImportPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLocale();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [preview, setPreview] = useState<BankImportPreview | null>(null);
  const [balanceEur, setBalanceEur] = useState('');
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [childBalanceEur, setChildBalanceEur] = useState<Record<string, string>>({});
  const [childBalances, setChildBalances] = useState<ChildBalanceInput[] | null>(null);
  const [salaryMode, setSalaryMode] = useState(false);
  const [modalStep, setModalStep] = useState<Step | null>(null);
  const [selectedIncomeIndex, setSelectedIncomeIndex] = useState<number | null>(null);
  const [forecastName, setForecastName] = useState('');
  const [useImportAmount, setUseImportAmount] = useState(true);
  const [customForecastEur, setCustomForecastEur] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BankImportResult | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const childAccounts = useMemo(() => {
    if (!selectedAccount || !isOberspartopf(selectedAccount)) return [];
    return accounts.filter((a) => a.parentAccountId === selectedAccount.id);
  }, [accounts, selectedAccount]);
  const incomeCandidates = useMemo(() => {
    if (!preview) return [];
    return preview.incomeIndices
      .map((index) => preview.transactions.find((tx) => tx.index === index))
      .filter((tx): tx is NonNullable<typeof tx> => Boolean(tx));
  }, [preview]);
  const selectedIncomeTx = useMemo(() => {
    if (selectedIncomeIndex == null || !preview) return null;
    return preview.transactions.find((tx) => tx.index === selectedIncomeIndex) ?? null;
  }, [preview, selectedIncomeIndex]);

  useEffect(() => {
    listAccounts()
      .then((rows) => {
        const ledgerAccounts = rows.filter(isBankImportAccount);
        setAccounts(ledgerAccounts);
        if (ledgerAccounts.length > 0) {
          setAccountId((current) => current || ledgerAccounts[0].id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    getDashboardSettings()
      .then((settings) => setSalaryMode(settings.periodMode === 'since_last_salary'))
      .catch(() => setSalaryMode(false));
  }, []);

  const balancesReady = useMemo(() => {
    if (childAccounts.length > 0) {
      return childBalances != null && childBalances.length === childAccounts.length;
    }
    return balanceCents != null;
  }, [childAccounts.length, childBalances, balanceCents]);

  const canImport = useMemo(
    () => Boolean(accountId && filePath && balancesReady && preview && !loading),
    [accountId, filePath, balancesReady, preview, loading],
  );

  function resetImportState() {
    setFilePath(null);
    setFileLabel('');
    setPreview(null);
    setBalanceEur('');
    setBalanceCents(null);
    setChildBalanceEur({});
    setChildBalances(null);
    setModalStep(null);
    setSelectedIncomeIndex(null);
    setForecastName('');
    setUseImportAmount(true);
    setCustomForecastEur('');
  }

  async function pickFile() {
    setError(null);
    setResult(null);
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: t('settings.bankImport.fileFilter'),
          extensions: ['csv', 'zip', 'xml', 'txt', '940'],
        },
      ],
    });
    if (!selected || Array.isArray(selected)) return;
    setLoading(true);
    try {
      const previewResult = await previewBankExport(selected);
      setFilePath(selected);
      setFileLabel(selected.split(/[/\\]/).pop() ?? selected);
      setPreview(previewResult);
      setBalanceEur('');
      setBalanceCents(null);
      setChildBalanceEur({});
      setChildBalances(null);
      setSelectedIncomeIndex(null);
      setForecastName('');
      setUseImportAmount(true);
      setCustomForecastEur('');
      setModalStep('balance');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function parseBalanceInput(raw: string): number {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('invalid');
    }
    return parseEurToCents(trimmed);
  }

  function confirmBalance() {
    try {
      if (childAccounts.length > 0) {
        const rows: ChildBalanceInput[] = childAccounts.map((child) => ({
          accountId: child.id,
          currentBalanceCents: parseBalanceInput(childBalanceEur[child.id] ?? ''),
        }));
        setChildBalances(rows);
        setError(null);
        if (selectedAccount && isSavingsPotAccount(selectedAccount)) {
          setModalStep(null);
          return;
        }
        openPrimaryIncomeStep(rows);
        return;
      }
      const cents = parseBalanceInput(balanceEur);
      setBalanceCents(cents);
      setError(null);
      if (selectedAccount && isSavingsPotAccount(selectedAccount)) {
        setModalStep(null);
        return;
      }
      openPrimaryIncomeStep(undefined, cents);
    } catch {
      setError(t('settings.bankImport.balanceInvalid'));
    }
  }

  function openPrimaryIncomeStep(nextChildBalances?: ChildBalanceInput[], nextBalanceCents?: number) {
    if (nextChildBalances) {
      setChildBalances(nextChildBalances);
    }
    if (nextBalanceCents != null) {
      setBalanceCents(nextBalanceCents);
    }
    if (incomeCandidates.length === 0) {
      setModalStep(null);
      return;
    }
    const defaultTx = incomeCandidates[incomeCandidates.length - 1];
    setSelectedIncomeIndex(defaultTx.index);
    setForecastName(defaultTx.title.trim() || t('settings.bankImport.primaryIncomeDefaultName'));
    setUseImportAmount(true);
    setCustomForecastEur((defaultTx.amountCents / 100).toFixed(2).replace('.', ','));
    setModalStep('primaryIncome');
  }

  function confirmPrimaryIncome() {
    if (selectedIncomeIndex == null) {
      setError(t('settings.bankImport.primaryIncomeRequired'));
      return;
    }
    if (!forecastName.trim()) {
      setError(t('settings.bankImport.primaryIncomeNameRequired'));
      return;
    }
    if (!useImportAmount) {
      try {
        parseBalanceInput(customForecastEur);
      } catch {
        setError(t('settings.bankImport.balanceInvalid'));
        return;
      }
    }
    setError(null);
    setModalStep(null);
  }

  function skipPrimaryIncome() {
    if (salaryMode) {
      setError(t('settings.bankImport.primaryIncomeRequired'));
      return;
    }
    setSelectedIncomeIndex(null);
    setModalStep(null);
  }

  function cancelModal() {
    setModalStep(null);
    resetImportState();
  }

  function buildPrimaryIncomeInput(): PrimaryIncomeImportInput | null {
    if (selectedIncomeIndex == null) return null;
    return {
      transactionIndex: selectedIncomeIndex,
      forecastName: forecastName.trim(),
      forecastAmountCents: useImportAmount
        ? selectedIncomeTx?.amountCents ?? 0
        : parseBalanceInput(customForecastEur),
      useImportAmount,
    };
  }

  async function runImport() {
    if (!filePath || !accountId || !preview || !balancesReady) return;
    if (
      salaryMode &&
      selectedAccount &&
      !isSavingsPotAccount(selectedAccount) &&
      incomeCandidates.length > 0 &&
      selectedIncomeIndex == null
    ) {
      setError(t('settings.bankImport.primaryIncomeRequired'));
      setModalStep('primaryIncome');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const importResult = await importBankExport({
        filePath,
        accountId,
        currentBalanceCents: childAccounts.length > 0 ? null : balanceCents,
        balanceAsOfDate: isoToday(),
        childBalances: childAccounts.length > 0 ? childBalances : null,
        primaryIncome:
          selectedAccount && isSavingsPotAccount(selectedAccount) ? null : buildPrimaryIncomeInput(),
      });
      setResult(importResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className={`fh-panel fh-settings-pref${embedded ? '' : ' fh-settings-pref-wide'}`} style={embedded ? undefined : { marginTop: 24 }}>
      <header className="fh-panel-head">
        <Landmark size={18} aria-hidden />
        <h2>{t('settings.bankImport.title')}</h2>
      </header>
      <p className="fh-panel-desc">{t('settings.bankImport.desc')}</p>
      <p className="fh-bank-import-hint">{t('settings.bankImport.verifyHint')}</p>
      <p className="fh-bank-import-hint">{t('settings.bankImport.formatHint')}</p>

      <div className="fh-bank-import-form">
        <label>
          {t('settings.bankImport.account')}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={accounts.length === 0}>
            {accounts.length === 0 ? <option value="">{t('settings.bankImport.noAccounts')}</option> : null}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <div className="fh-bank-import-file-row">
          <button type="button" className="fh-btn ghost" onClick={pickFile} disabled={loading}>
            <FileUp size={16} aria-hidden />
            {t('settings.bankImport.chooseFile')}
          </button>
          <span className="fh-bank-import-file-name">{fileLabel || t('settings.bankImport.noFile')}</span>
          {balancesReady ? (
            <button
              type="button"
              className="fh-link-button fh-bank-import-balance-link"
              onClick={() => setModalStep('balance')}
            >
              {childAccounts.length > 0
                ? t('settings.bankImport.childBalancesSet', { count: childAccounts.length })
                : t('settings.bankImport.balanceSet', { amount: ((balanceCents ?? 0) / 100).toFixed(2) })}
            </button>
          ) : null}
          {selectedIncomeIndex != null ? (
            <button
              type="button"
              className="fh-link-button fh-bank-import-balance-link"
              onClick={() => setModalStep('primaryIncome')}
            >
              {t('settings.bankImport.primaryIncomeSet')}
            </button>
          ) : null}
          <button type="button" className="fh-btn primary fh-bank-import-import-btn" onClick={runImport} disabled={!canImport}>
            {loading ? t('settings.bankImport.importing') : t('settings.bankImport.import')}
          </button>
        </div>
      </div>

      {error ? <div className="fh-bank-import-result fh-bank-import-result--error">{error}</div> : null}

      {result ? (
        <div className="fh-bank-import-result fh-bank-import-result--ok">
          <strong>{result.message}</strong>
          <ul>
            <li>{t('settings.bankImport.resultFormat', { format: result.format })}</li>
            {result.iban ? <li>{t('settings.bankImport.resultIban', { iban: result.iban })}</li> : null}
            <li>{t('settings.bankImport.resultImported', { count: result.importedCount })}</li>
            <li>{t('settings.bankImport.resultSkipped', { count: result.skippedCount })}</li>
            {result.transferCount > 0 ? (
              <li>{t('settings.bankImport.resultTransfers', { count: result.transferCount })}</li>
            ) : null}
            {result.openingBalanceSet ? <li>{t('settings.bankImport.resultOpeningBalance')}</li> : null}
            {result.closingBalanceCents != null && result.closingBalanceDate ? (
              <li>
                {t('settings.bankImport.resultClosingBalance', {
                  date: result.closingBalanceDate,
                  amount: (result.closingBalanceCents / 100).toFixed(2),
                })}
              </li>
            ) : null}
          </ul>
          {result.warnings.length > 0 ? (
            <div className="fh-bank-import-warnings">
              {result.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={modalStep === 'balance'}
        title={
          childAccounts.length > 0
            ? t('settings.bankImport.childBalanceModalTitle')
            : t('settings.bankImport.balanceModalTitle')
        }
        onClose={cancelModal}
      >
        <div className="fh-form">
          <p style={{ marginTop: 0, lineHeight: 1.5 }}>
            {childAccounts.length > 0
              ? t('settings.bankImport.childBalanceModalDesc')
              : t('settings.bankImport.balanceModalDesc')}
          </p>
          {childAccounts.length > 0 ? (
            childAccounts.map((child) => (
              <label key={child.id}>
                {child.name}
                <input
                  value={childBalanceEur[child.id] ?? ''}
                  onChange={(e) =>
                    setChildBalanceEur((current) => ({ ...current, [child.id]: e.target.value }))
                  }
                  placeholder="1.234,56"
                />
              </label>
            ))
          ) : (
            <label>
              {t('settings.bankImport.balanceModalLabel')}
              <input
                value={balanceEur}
                onChange={(e) => setBalanceEur(e.target.value)}
                placeholder="1.234,56"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmBalance();
                }}
              />
            </label>
          )}
          <div className="fh-form-actions">
            <button type="button" className="fh-btn ghost" onClick={cancelModal}>
              {t('common.cancel')}
            </button>
            <div className="fh-form-actions-right">
              <button type="button" className="fh-btn primary" onClick={confirmBalance}>
                {t('settings.bankImport.balanceModalConfirm')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={modalStep === 'primaryIncome'}
        title={t('settings.bankImport.primaryIncomeModalTitle')}
        onClose={() => setModalStep(null)}
      >
        <div className="fh-form">
          <p style={{ marginTop: 0, lineHeight: 1.5 }}>{t('settings.bankImport.primaryIncomeModalDesc')}</p>
          <label>
            {t('settings.bankImport.primaryIncomePick')}
            <select
              value={selectedIncomeIndex ?? ''}
              onChange={(e) => {
                const index = Number(e.target.value);
                setSelectedIncomeIndex(index);
                const tx = incomeCandidates.find((row) => row.index === index);
                if (tx) {
                  setForecastName(tx.title.trim() || t('settings.bankImport.primaryIncomeDefaultName'));
                  setCustomForecastEur((tx.amountCents / 100).toFixed(2).replace('.', ','));
                }
              }}
            >
              {incomeCandidates.map((tx) => (
                <option key={tx.index} value={tx.index}>
                  {tx.date} · {tx.title} · {formatEurFromCents(tx.amountCents)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('settings.bankImport.primaryIncomeName')}
            <input value={forecastName} onChange={(e) => setForecastName(e.target.value)} />
          </label>
          <label className="fh-checkbox-row">
            <input
              type="checkbox"
              checked={useImportAmount}
              onChange={(e) => setUseImportAmount(e.target.checked)}
            />
            {t('settings.bankImport.primaryIncomeUseImportAmount')}
          </label>
          {!useImportAmount ? (
            <label>
              {t('settings.bankImport.primaryIncomeCustomAmount')}
              <input value={customForecastEur} onChange={(e) => setCustomForecastEur(e.target.value)} />
            </label>
          ) : null}
          <div className="fh-form-actions">
            {!salaryMode ? (
              <button type="button" className="fh-btn ghost" onClick={skipPrimaryIncome}>
                {t('settings.bankImport.primaryIncomeSkip')}
              </button>
            ) : (
              <button type="button" className="fh-btn ghost" onClick={cancelModal}>
                {t('common.cancel')}
              </button>
            )}
            <div className="fh-form-actions-right">
              <button type="button" className="fh-btn primary" onClick={confirmPrimaryIncome}>
                {t('settings.bankImport.balanceModalConfirm')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </article>
  );
}
