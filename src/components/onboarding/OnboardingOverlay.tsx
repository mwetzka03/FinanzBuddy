import { useCallback, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  Account,
  BankImportPreview,
  DashboardPeriodMode,
  IncomeForecastDueRule,
  IsoDate,
  PrimaryIncomeImportInput,
} from '../../lib/types';
import type { Locale } from '../../i18n/types';
import { translate } from '../../i18n/translate';
import { useLocale } from '../../i18n/LocaleProvider';
import {
  completeSetup,
  createIncomeForecast,
  importBankExport,
  importUserData,
  listAccounts,
  listIncomeForecasts,
  previewBankExport,
  setAccountOpeningBalance,
  setTimeframeConfig,
  setMainAccount,
  setPrimaryIncomeForecast,
  updateAccount,
} from '../../tauri/api';
import {
  isBankImportAccount,
  isMainAccountCandidate,
  isOberspartopf,
  accountKindLabel,
  normalizeIbanInput,
  sortOpeningBalanceAccounts,
} from '../../lib/accounts';
import { useTheme } from '../../lib/theme';
import { Checkbox } from '../common/Checkbox';
import { inferIncomeDueRule, deriveIncomeDate } from '../../lib/businessDays';
import { dayBefore, formatDisplayDate, isoToday, monthAdd, monthStartDate } from '../../lib/date';
import type { IsoMonth } from '../../lib/types';
import { formatEurFromCents, parseEurToCents } from '../../lib/money';
import { AccountFormModal } from '../settings/AccountFormModal';

type SetupMode = 'manual' | 'bank_import';

type Step =
  | 'language'
  | 'theme'
  | 'new-user'
  | 'json-import'
  | 'period'
  | 'mode'
  | 'accounts'
  | 'bank-files'
  | 'bank-income'
  | 'bank-balance'
  | 'bank-calendar-balance'
  | 'manual-balances'
  | 'manual-income'
  | 'review';

type AccountImportDraft = {
  filePath: string;
  fileLabel: string;
  preview: BankImportPreview;
};

export function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const { t, setLocale } = useLocale();
  const { mode: themeMode, setMode } = useTheme();
  const [step, setStep] = useState<Step>('language');
  const [languageChoice, setLanguageChoice] = useState<Locale>('en');
  const [isNewUser, setIsNewUser] = useState<boolean | null>(null);
  const [jsonImportPath, setJsonImportPath] = useState<string | null>(null);
  const [jsonImportLabel, setJsonImportLabel] = useState<string | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode | null>(null);
  const [periodMode, setPeriodMode] = useState<DashboardPeriodMode>('since_last_salary');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [mainName, setMainName] = useState('');
  const [mainIban, setMainIban] = useState('');
  const [mainLiquid, setMainLiquid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [importsByAccountId, setImportsByAccountId] = useState<Map<string, AccountImportDraft>>(new Map());
  const [selectedEmployerIban, setSelectedEmployerIban] = useState('');
  const [forecastName, setForecastName] = useState('');
  const [forecastAmountEur, setForecastAmountEur] = useState('');
  const [bankDueRule, setBankDueRule] = useState<IncomeForecastDueRule>('last_business_day');
  const [bankDayOfMonth, setBankDayOfMonth] = useState('');
  const [openingBalancesEur, setOpeningBalancesEur] = useState<Record<string, string>>({});
  const [calendarBalancesEur, setCalendarBalancesEur] = useState<Record<string, string>>({});
  const [manualBalancesEur, setManualBalancesEur] = useState<Record<string, string>>({});
  const [manualIncomeName, setManualIncomeName] = useState('');
  const [manualIncomeEur, setManualIncomeEur] = useState('');
  const [manualDueRule, setManualDueRule] = useState<IncomeForecastDueRule>('last_business_day');

  const refreshAccounts = useCallback(async () => {
    const rows = await listAccounts();
    setAccounts(rows);
  }, []);

  const bankImportAccounts = useMemo(
    () => accounts.filter((a) => isBankImportAccount(a) && !isOberspartopf(a)),
    [accounts],
  );

  useEffect(() => {
    refreshAccounts().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshAccounts]);

  const mainAccount = useMemo(
    () => accounts.find((a) => a.isMain && isMainAccountCandidate(a)) ?? accounts.find(isMainAccountCandidate),
    [accounts],
  );

  const sortedOpeningBalanceAccounts = useMemo(
    () => sortOpeningBalanceAccounts(accounts, mainAccount?.id),
    [accounts, mainAccount?.id],
  );

  const otherAccounts = useMemo(
    () => accounts.filter((a) => a.id !== mainAccount?.id),
    [accounts, mainAccount?.id],
  );

  useEffect(() => {
    if (!mainAccount) return;
    setMainName(mainAccount.name);
    setMainIban(mainAccount.iban ?? '');
    setMainLiquid(mainAccount.isLiquid);
  }, [mainAccount?.id, mainAccount?.name, mainAccount?.iban, mainAccount?.isLiquid]);

  const mainImport = mainAccount ? importsByAccountId.get(mainAccount.id) : undefined;

  const incomeCandidates = useMemo(() => {
    if (!mainImport) return [];
    return mainImport.preview.incomeIndices
      .map((index) => mainImport.preview.transactions.find((tx) => tx.index === index))
      .filter((tx): tx is NonNullable<typeof tx> => Boolean(tx));
  }, [mainImport]);

  const employerIbanOptions = useMemo(() => {
    const groups = new Map<string, NonNullable<(typeof incomeCandidates)[number]>[]>();
    for (const tx of incomeCandidates) {
      const raw = tx.counterpartyIban?.trim();
      if (!raw) continue;
      const iban = normalizeIbanInput(raw);
      if (!iban) continue;
      const list = groups.get(iban) ?? [];
      list.push(tx);
      groups.set(iban, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [incomeCandidates]);

  const incomesForSelectedIban = useMemo(() => {
    if (!selectedEmployerIban) return [];
    return employerIbanOptions.find(([iban]) => iban === selectedEmployerIban)?.[1] ?? [];
  }, [employerIbanOptions, selectedEmployerIban]);

  const firstPrimaryIncomeDate = useMemo((): IsoDate | null => {
    if (incomesForSelectedIban.length === 0) return null;
    let min = incomesForSelectedIban[0].date;
    for (const tx of incomesForSelectedIban) {
      if (tx.date < min) min = tx.date;
    }
    return min as IsoDate;
  }, [incomesForSelectedIban]);

  const openingBalanceDate = firstPrimaryIncomeDate ? dayBefore(firstPrimaryIncomeDate) : null;

  const calendarDashboardStartDate = useMemo((): IsoDate | null => {
    if (periodMode !== 'calendar_month') return null;
    if (firstPrimaryIncomeDate) {
      const month = monthAdd(firstPrimaryIncomeDate.slice(0, 7) as IsoMonth, 1);
      return monthStartDate(month);
    }
    return monthStartDate(monthAdd(isoToday().slice(0, 7) as IsoMonth, 1));
  }, [periodMode, firstPrimaryIncomeDate]);

  const balanceAnchorDate = useMemo((): IsoDate => {
    if (periodMode === 'since_last_salary' && openingBalanceDate) {
      return openingBalanceDate;
    }
    return isoToday();
  }, [periodMode, openingBalanceDate]);

  const stepOrder = useMemo((): Step[] => {
    const start: Step[] = ['language', 'theme', 'new-user'];
    if (isNewUser === false) return [...start, 'json-import'];
    if (isNewUser !== true) return start;
    const prefix: Step[] = [...start, 'period', 'mode', 'accounts'];
    if (setupMode === 'bank_import') {
      const steps: Step[] = [...prefix, 'bank-files'];
      if (periodMode === 'since_last_salary') {
        steps.push('bank-income', 'bank-balance');
      } else {
        steps.push('bank-income', 'bank-calendar-balance');
      }
      steps.push('review');
      return steps;
    }
    const steps: Step[] = [...prefix, 'manual-balances'];
    if (periodMode === 'since_last_salary') {
      steps.push('manual-income');
    }
    steps.push('review');
    return steps;
  }, [isNewUser, setupMode, periodMode]);

  const stepIndex = stepOrder.indexOf(step);
  const onLanguageStep = step === 'language';
  const tEn = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
  const tView = onLanguageStep ? tEn : t;

  function goBack() {
    setError(null);
    if (stepIndex > 0) setStep(stepOrder[stepIndex - 1]);
  }

  function goNext() {
    setError(null);
    if (stepIndex < stepOrder.length - 1) setStep(stepOrder[stepIndex + 1]);
  }

  function applyEmployerIban(iban: string) {
    setSelectedEmployerIban(iban);
    const txs = employerIbanOptions.find(([value]) => value === iban)?.[1] ?? [];
    if (txs.length === 0) return;
    let first = txs[0];
    for (const tx of txs) {
      if (tx.date < first.date) first = tx;
    }
    setForecastName(first.title.trim() || t('settings.bankImport.primaryIncomeDefaultName'));
    const inferred = inferIncomeDueRule(first.date as IsoDate);
    setBankDueRule(inferred.dueRule);
    setBankDayOfMonth(inferred.dayOfMonth != null ? String(inferred.dayOfMonth) : '');
  }

  function validateAccountsStep(): boolean {
    if (!mainAccount) {
      setError(t('onboarding.errorMainAccount'));
      return false;
    }
    if (!mainName.trim()) {
      setError(t('onboarding.errorMainAccount'));
      return false;
    }
    if (!mainLiquid) {
      setError(t('onboarding.errorMainLiquid'));
      return false;
    }
    if (setupMode === 'bank_import' && !mainIban.trim()) {
      setError(t('onboarding.errorMainIban'));
      return false;
    }
    return true;
  }

  async function saveMainAccountDraft() {
    if (!mainAccount) return;
    const normalizedIban = mainIban.trim() ? normalizeIbanInput(mainIban.trim()) : null;
    await updateAccount({
      id: mainAccount.id,
      name: mainName.trim(),
      isLiquid: mainLiquid,
      iban: normalizedIban,
    });
    if (!mainAccount.isMain) {
      await setMainAccount(mainAccount.id);
    }
    await refreshAccounts();
  }

  async function pickJsonImportFile() {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: t('onboarding.jsonImportFileFilter'), extensions: ['json'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    setJsonImportPath(selected);
    setJsonImportLabel(selected.split(/[/\\]/).pop() ?? selected);
  }

  async function pickImportForAccount(accountId: string) {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: t('settings.bankImport.fileFilter'), extensions: ['csv', 'zip', 'xml', 'txt', '940'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    setBusy(true);
    try {
      const preview = await previewBankExport(selected);
      setImportsByAccountId((prev) => {
        const next = new Map(prev);
        next.set(accountId, {
          filePath: selected,
          fileLabel: selected.split(/[/\\]/).pop() ?? selected,
          preview,
        });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    if (!setupMode) return;
    setBusy(true);
    setError(null);
    try {
      const incomeDate =
        periodMode === 'calendar_month'
          ? 0
          : setupMode === 'bank_import'
            ? deriveIncomeDate(
                periodMode,
                bankDueRule,
                bankDueRule === 'calendar_day' ? Number(bankDayOfMonth || '1') : null,
              )
            : deriveIncomeDate(
                periodMode,
                manualDueRule,
                manualDueRule === 'calendar_day' ? Number(isoToday().slice(8, 10)) : null,
              );
      await setTimeframeConfig(periodMode === 'calendar_month', incomeDate);

      if (setupMode === 'bank_import') {
        if (!mainAccount || !mainImport) {
          throw new Error(t('onboarding.errorIncompleteBank'));
        }

        if (periodMode === 'calendar_month') {
          if (!calendarDashboardStartDate) {
            throw new Error(t('onboarding.errorIncompleteBank'));
          }
          if (!selectedEmployerIban) {
            throw new Error(t('onboarding.errorEmployerIban'));
          }
          const primaryIncome: PrimaryIncomeImportInput = {
            forecastName: forecastName.trim(),
            forecastAmountCents: parseEurToCents(forecastAmountEur.trim()),
            useImportAmount: false,
            employerIban: normalizeIbanInput(selectedEmployerIban)!,
            dueRule: bankDueRule,
            dayOfMonth: bankDueRule === 'calendar_day' ? Number(bankDayOfMonth || '1') : null,
          };
          const mainBalanceCents = parseEurToCents(calendarBalancesEur[mainAccount.id]?.trim() ?? '');

          for (const account of sortedOpeningBalanceAccounts) {
            if (account.id === mainAccount.id) continue;
            const raw = calendarBalancesEur[account.id]?.trim();
            if (!raw) continue;
            await setAccountOpeningBalance(
              account.id,
              parseEurToCents(raw),
              calendarDashboardStartDate,
            );
          }

          for (const account of bankImportAccounts) {
            const draft = importsByAccountId.get(account.id);
            if (!draft) continue;
            const isMain = account.id === mainAccount.id;
            await importBankExport({
              filePath: draft.filePath,
              accountId: account.id,
              currentBalanceCents: isMain ? mainBalanceCents : undefined,
              balanceAsOfDate: isMain ? calendarDashboardStartDate : undefined,
              primaryIncome: isMain ? primaryIncome : undefined,
            });
          }

          for (const account of sortedOpeningBalanceAccounts) {
            const raw = calendarBalancesEur[account.id]?.trim();
            if (!raw) {
              throw new Error(t('onboarding.errorAccountBalance', { name: account.name }));
            }
            await setAccountOpeningBalance(
              account.id,
              parseEurToCents(raw),
              calendarDashboardStartDate,
            );
          }
        } else {
          const balanceCents = parseEurToCents(openingBalancesEur[mainAccount.id]?.trim() ?? '');
          if (!selectedEmployerIban) {
            throw new Error(t('onboarding.errorEmployerIban'));
          }
          const primaryIncome: PrimaryIncomeImportInput = {
            forecastName: forecastName.trim(),
            forecastAmountCents: parseEurToCents(forecastAmountEur.trim()),
            useImportAmount: false,
            employerIban: normalizeIbanInput(selectedEmployerIban)!,
            dueRule: bankDueRule,
            dayOfMonth: bankDueRule === 'calendar_day' ? Number(bankDayOfMonth || '1') : null,
          };

          for (const account of sortedOpeningBalanceAccounts) {
            if (account.id === mainAccount.id) continue;
            const raw = openingBalancesEur[account.id]?.trim();
            if (!raw) continue;
            await setAccountOpeningBalance(account.id, parseEurToCents(raw), balanceAnchorDate);
          }

          for (const account of bankImportAccounts) {
            const draft = importsByAccountId.get(account.id);
            if (!draft) continue;
            const isMain = account.id === mainAccount.id;
            await importBankExport({
              filePath: draft.filePath,
              accountId: account.id,
              currentBalanceCents: isMain ? balanceCents : undefined,
              balanceAsOfDate: isMain ? balanceAnchorDate : undefined,
              primaryIncome: isMain ? primaryIncome : undefined,
            });
          }
        }
      } else {
        const today = isoToday();
        for (const account of sortedOpeningBalanceAccounts) {
          const raw = manualBalancesEur[account.id]?.trim();
          if (!raw) continue;
          await setAccountOpeningBalance(account.id, parseEurToCents(raw), today);
        }
        if (periodMode === 'since_last_salary' && manualIncomeName.trim() && manualIncomeEur.trim()) {
          await createIncomeForecast({
            name: manualIncomeName.trim(),
            amountCents: parseEurToCents(manualIncomeEur.trim()),
            cadence: 'monthly',
            firstChargeDate: today,
            dueRule: manualDueRule,
            dayOfMonth: manualDueRule === 'calendar_day' ? Number(today.slice(8, 10)) : null,
            endChargeDate: null,
            accountId: mainAccount?.id,
          });
          const forecasts = await listIncomeForecasts();
          const created = forecasts.find((f) => f.name === manualIncomeName.trim());
          if (created) await setPrimaryIncomeForecast(created.id);
        }
      }

      await completeSetup(setupMode);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onContinueFromStep() {
    if (step === 'language') {
      setLocale(languageChoice);
      goNext();
      return;
    }
    if (step === 'theme') {
      goNext();
      return;
    }
    if (step === 'new-user') {
      if (isNewUser === null) {
        setError(t('onboarding.errorNewUserChoice'));
        return;
      }
      if (isNewUser === false) {
        setStep('json-import');
        return;
      }
      goNext();
      return;
    }
    if (step === 'json-import') {
      if (!jsonImportPath) {
        setError(t('onboarding.errorJsonImportFile'));
        return;
      }
      setBusy(true);
      try {
        await importUserData(jsonImportPath);
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 'mode') {
      if (!setupMode) {
        setError(t('onboarding.errorMode'));
        return;
      }
      goNext();
      return;
    }
    if (step === 'accounts') {
      if (!validateAccountsStep()) return;
      setBusy(true);
      try {
        await saveMainAccountDraft();
        goNext();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 'period') {
      goNext();
      return;
    }
    if (step === 'bank-files') {
      if (!mainImport) {
        setError(t('onboarding.errorMainImport'));
        return;
      }
      goNext();
      return;
    }
    if (step === 'bank-income') {
      if (!selectedEmployerIban) {
        setError(t('onboarding.errorEmployerIban'));
        return;
      }
      if (!forecastName.trim()) {
        setError(t('settings.bankImport.primaryIncomeNameRequired'));
        return;
      }
      try {
        parseEurToCents(forecastAmountEur.trim());
      } catch {
        setError(t('onboarding.errorForecastAmount'));
        return;
      }
      goNext();
      return;
    }
    if (step === 'bank-balance') {
      if (mainAccount && !openingBalancesEur[mainAccount.id]?.trim()) {
        setError(t('onboarding.errorMainBalance'));
        return;
      }
      for (const account of sortedOpeningBalanceAccounts) {
        if (account.id === mainAccount?.id) continue;
        if (!openingBalancesEur[account.id]?.trim()) {
          setError(t('onboarding.errorAccountBalance', { name: account.name }));
          return;
        }
      }
      try {
        for (const account of sortedOpeningBalanceAccounts) {
          const raw = openingBalancesEur[account.id]?.trim();
          if (!raw) continue;
          parseEurToCents(raw);
        }
      } catch {
        setError(t('settings.bankImport.balanceInvalid'));
        return;
      }
      goNext();
      return;
    }
    if (step === 'bank-calendar-balance') {
      if (!calendarDashboardStartDate) {
        setError(t('onboarding.errorIncompleteBank'));
        return;
      }
      for (const account of sortedOpeningBalanceAccounts) {
        if (!calendarBalancesEur[account.id]?.trim()) {
          setError(t('onboarding.errorAccountBalance', { name: account.name }));
          return;
        }
      }
      try {
        for (const account of sortedOpeningBalanceAccounts) {
          const raw = calendarBalancesEur[account.id]?.trim();
          if (!raw) continue;
          parseEurToCents(raw);
        }
      } catch {
        setError(t('settings.bankImport.balanceInvalid'));
        return;
      }
      goNext();
      return;
    }
    if (step === 'manual-balances') {
      if (mainAccount && !manualBalancesEur[mainAccount.id]?.trim()) {
        setError(t('onboarding.errorMainBalance'));
        return;
      }
      for (const account of sortedOpeningBalanceAccounts) {
        if (account.id === mainAccount?.id) continue;
        if (!manualBalancesEur[account.id]?.trim()) {
          setError(t('onboarding.errorAccountBalance', { name: account.name }));
          return;
        }
      }
      goNext();
      return;
    }
    if (step === 'manual-income') {
      if (!manualIncomeName.trim() || !manualIncomeEur.trim()) {
        setError(t('onboarding.errorManualIncome'));
        return;
      }
      goNext();
      return;
    }
  }

  useEffect(() => {
    if (step !== 'bank-income') return;
    if (selectedEmployerIban || employerIbanOptions.length === 0) return;
    applyEmployerIban(employerIbanOptions[0][0]);
  }, [step, selectedEmployerIban, employerIbanOptions]);

  return (
    <div className="fh-onboarding-overlay" role="dialog" aria-modal="true">
      <div className="fh-onboarding-panel">
        <header className="fh-onboarding-header">
          <h1>{tView('onboarding.title')}</h1>
          <p>{tView('onboarding.subtitle')}</p>
        </header>

        <div className="fh-onboarding-progress">
          {stepOrder.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'active' : ''} />
          ))}
        </div>

        {error ? <p className="fh-onboarding-error">{error}</p> : null}

        {step === 'language' ? (
          <section className="fh-onboarding-step">
            <h2>{tEn('onboarding.languageTitle')}</h2>
            <p className="fh-onboarding-hint">{tEn('onboarding.languageHint')}</p>
            <div className="fh-segment stretch">
              <button
                type="button"
                className={languageChoice === 'en' ? 'active' : ''}
                onClick={() => setLanguageChoice('en')}
              >
                {tEn('onboarding.languageEn')}
              </button>
              <button
                type="button"
                className={languageChoice === 'de' ? 'active' : ''}
                onClick={() => setLanguageChoice('de')}
              >
                {tEn('onboarding.languageDe')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'theme' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.themeTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.themeHint')}</p>
            <div className="fh-segment stretch">
              <button
                type="button"
                className={themeMode === 'light' ? 'active' : ''}
                onClick={() => setMode('light')}
              >
                {t('onboarding.themeLight')}
              </button>
              <button
                type="button"
                className={themeMode === 'dark' ? 'active' : ''}
                onClick={() => setMode('dark')}
              >
                {t('onboarding.themeDark')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'new-user' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.newUserTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.newUserHint')}</p>
            <div className="fh-onboarding-cards">
              <button
                type="button"
                className={`fh-onboarding-card${isNewUser === true ? ' selected' : ''}`}
                onClick={() => setIsNewUser(true)}
              >
                <strong>{t('onboarding.newUserYesTitle')}</strong>
                <span>{t('onboarding.newUserYesDesc')}</span>
              </button>
              <button
                type="button"
                className={`fh-onboarding-card${isNewUser === false ? ' selected' : ''}`}
                onClick={() => setIsNewUser(false)}
              >
                <strong>{t('onboarding.newUserNoTitle')}</strong>
                <span>{t('onboarding.newUserNoDesc')}</span>
              </button>
            </div>
          </section>
        ) : null}

        {step === 'json-import' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.jsonImportTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.jsonImportHint')}</p>
            <div className="fh-onboarding-row">
              <div>{jsonImportLabel ?? t('onboarding.noFile')}</div>
              <button type="button" className="fh-btn ghost" onClick={() => void pickJsonImportFile()} disabled={busy}>
                {t('onboarding.pickJsonFile')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'mode' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.modeTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.modeHint')}</p>
            <div className="fh-onboarding-cards">
              <button
                type="button"
                className={`fh-onboarding-card${setupMode === 'manual' ? ' selected' : ''}`}
                onClick={() => setSetupMode('manual')}
              >
                <strong>{t('onboarding.manualTitle')}</strong>
                <span>{t('onboarding.manualDesc')}</span>
              </button>
              <button
                type="button"
                className={`fh-onboarding-card${setupMode === 'bank_import' ? ' selected' : ''}`}
                onClick={() => setSetupMode('bank_import')}
              >
                <strong>{t('onboarding.bankTitle')}</strong>
                <span>{t('onboarding.bankDesc')}</span>
                <span>{t('onboarding.bankVerifyHint')}</span>
              </button>
            </div>
          </section>
        ) : null}

        {step === 'accounts' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.accountsTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.accountsHint')}</p>
            {mainAccount ? (
              <div className="fh-onboarding-main-account">
                <h3>{t('onboarding.mainAccountTitle')}</h3>
                <p className="fh-onboarding-hint">{t('onboarding.mainAccountHint')}</p>
                <label>
                  {t('common.name')}
                  <input value={mainName} onChange={(e) => setMainName(e.target.value)} />
                </label>
                <label>
                  {t('accounts.iban')}
                  <input
                    value={mainIban}
                    onChange={(e) => setMainIban(e.target.value)}
                    placeholder={t('accounts.ibanPlaceholder')}
                    autoCapitalize="characters"
                  />
                </label>
                <Checkbox checked={mainLiquid} onChange={setMainLiquid}>
                  {t('accounts.liquid')}
                </Checkbox>
              </div>
            ) : (
              <p className="fh-onboarding-hint">{t('onboarding.errorMainAccount')}</p>
            )}
            {otherAccounts.length > 0 ? (
              <>
                <h3>{t('onboarding.otherAccounts')}</h3>
                <ul className="fh-onboarding-list">
                  {otherAccounts.map((a) => (
                    <li key={a.id} className="fh-onboarding-row">
                      <span>
                        <strong>{a.name}</strong>
                        {' · '}
                        {accountKindLabel(a, t)}
                        {a.iban ? ` · ${a.iban}` : ''}
                      </span>
                      <button type="button" className="fh-btn ghost" onClick={() => setEditAccount(a)}>
                        {t('onboarding.editAccount')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <button type="button" className="fh-btn ghost" onClick={() => setAccountModalOpen(true)}>
              {t('onboarding.addAccount')}
            </button>
          </section>
        ) : null}

        {step === 'period' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.periodTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.periodHint')}</p>
            <div className="fh-segment stretch">
              <button
                type="button"
                className={periodMode === 'calendar_month' ? 'active' : ''}
                onClick={() => setPeriodMode('calendar_month')}
              >
                {t('settings.dashboard.calendarMonth')}
              </button>
              <button
                type="button"
                className={periodMode === 'since_last_salary' ? 'active' : ''}
                onClick={() => setPeriodMode('since_last_salary')}
              >
                {t('settings.dashboard.sinceLastSalary')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'bank-files' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.bankFilesTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.bankFilesHint')}</p>
            <p className="fh-onboarding-hint">{t('onboarding.bankFilesMainOnlyWarning')}</p>
            <p className="fh-onboarding-hint">{t('onboarding.bankVerifyHint')}</p>
            {bankImportAccounts.map((account) => {
              const draft = importsByAccountId.get(account.id);
              const required = account.id === mainAccount?.id;
              return (
                <div key={account.id} className="fh-onboarding-row">
                  <div>
                    <strong>{account.name}</strong>
                    {required ? ` (${t('common.required')})` : ''}
                  </div>
                  <div>{draft ? draft.fileLabel : t('onboarding.noFile')}</div>
                  <button type="button" className="fh-btn ghost" disabled={busy} onClick={() => pickImportForAccount(account.id)}>
                    {t('onboarding.pickFile')}
                  </button>
                </div>
              );
            })}
          </section>
        ) : null}

        {step === 'bank-income' && mainImport ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.bankIncomeTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.bankIncomeHint')}</p>
            {employerIbanOptions.length === 0 ? (
              <p className="fh-onboarding-hint">{t('onboarding.bankIncomePreviewEmpty')}</p>
            ) : (
              <>
                <label>
                  {t('onboarding.bankIncomePickIban')}
                  <select
                    value={selectedEmployerIban}
                    onChange={(e) => applyEmployerIban(e.target.value)}
                  >
                    <option value="">{t('onboarding.bankIncomeSelectIban')}</option>
                    {employerIbanOptions.map(([iban, txs]) => (
                      <option key={iban} value={iban}>
                        {iban} ({txs.length})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedEmployerIban && firstPrimaryIncomeDate && calendarDashboardStartDate && periodMode === 'calendar_month' ? (
                  <p className="fh-onboarding-hint">
                    {t('onboarding.bankIncomeFirstSalaryCalendar', {
                      date: formatDisplayDate(firstPrimaryIncomeDate),
                      balanceDate: formatDisplayDate(calendarDashboardStartDate),
                    })}
                  </p>
                ) : null}
                {selectedEmployerIban && firstPrimaryIncomeDate && openingBalanceDate && periodMode === 'since_last_salary' ? (
                  <p className="fh-onboarding-hint">
                    {t('onboarding.bankIncomeFirstSalary', {
                      date: formatDisplayDate(firstPrimaryIncomeDate),
                      balanceDate: formatDisplayDate(openingBalanceDate),
                    })}
                  </p>
                ) : null}
                {incomesForSelectedIban.length > 0 ? (
                  <>
                    <h3>{t('onboarding.bankIncomePreview')}</h3>
                    <ul className="fh-onboarding-list">
                      {[...incomesForSelectedIban]
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map((tx) => (
                          <li key={tx.index}>
                            {formatDisplayDate(tx.date as IsoDate)} · {tx.title} ·{' '}
                            {formatEurFromCents(tx.amountCents)}
                          </li>
                        ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
            <label>
              {t('settings.bankImport.primaryIncomeName')}
              <input value={forecastName} onChange={(e) => setForecastName(e.target.value)} />
            </label>
            <label>
              {t('onboarding.bankIncomeForecastAmount')}
              <input
                value={forecastAmountEur}
                onChange={(e) => setForecastAmountEur(e.target.value)}
                placeholder="0,00"
              />
              <span className="fh-form-hint">{t('onboarding.bankIncomeForecastAmountHint')}</span>
            </label>
            <label>
              {t('onboarding.bankIncomeDueRule')}
              <select
                value={bankDueRule}
                onChange={(e) => setBankDueRule(e.target.value as IncomeForecastDueRule)}
              >
                <option value="last_business_day">{t('dueRule.last_business_day')}</option>
                <option value="first_business_day">{t('dueRule.first_business_day')}</option>
                <option value="calendar_day">{t('dueRule.calendar_day')}</option>
              </select>
            </label>
            {bankDueRule === 'calendar_day' ? (
              <label>
                {t('onboarding.bankIncomeDayOfMonth')}
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={bankDayOfMonth}
                  onChange={(e) => setBankDayOfMonth(e.target.value)}
                />
              </label>
            ) : null}
          </section>
        ) : null}

        {step === 'bank-balance' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.bankBalanceTitle')}</h2>
            <p className="fh-onboarding-hint">
              {periodMode === 'calendar_month'
                ? t('onboarding.bankBalanceHintImport', { date: formatDisplayDate(balanceAnchorDate) })
                : t('onboarding.bankBalanceHint', { date: formatDisplayDate(balanceAnchorDate) })}
            </p>
            <p className="fh-onboarding-hint">{t('onboarding.bankBalanceOberspartopfHint')}</p>
            {sortedOpeningBalanceAccounts.map((account) => {
              const parentName = account.parentAccountId
                ? accounts.find((a) => a.id === account.parentAccountId)?.name
                : null;
              return (
              <label key={account.id}>
                {account.name}
                {parentName ? ` (${parentName})` : ''}
                {account.id === mainAccount?.id ? ` (${t('common.required')})` : ''}
                <input
                  value={openingBalancesEur[account.id] ?? ''}
                  onChange={(e) =>
                    setOpeningBalancesEur((prev) => ({ ...prev, [account.id]: e.target.value }))
                  }
                  placeholder="0,00"
                />
                <span className="fh-form-hint">
                  {t('onboarding.bankBalanceLabel', { date: formatDisplayDate(balanceAnchorDate) })}
                </span>
              </label>
              );
            })}
          </section>
        ) : null}

        {step === 'bank-calendar-balance' && calendarDashboardStartDate ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.bankCalendarBalanceTitle')}</h2>
            <p className="fh-onboarding-hint">
              {t('onboarding.bankCalendarBalanceHint', {
                date: formatDisplayDate(calendarDashboardStartDate),
              })}
            </p>
            <p className="fh-onboarding-hint">{t('onboarding.bankBalanceOberspartopfHint')}</p>
            {sortedOpeningBalanceAccounts.map((account) => {
              const parentName = account.parentAccountId
                ? accounts.find((a) => a.id === account.parentAccountId)?.name
                : null;
              return (
                <label key={account.id}>
                  {account.name}
                  {parentName ? ` (${parentName})` : ''}
                  <input
                    value={calendarBalancesEur[account.id] ?? ''}
                    onChange={(e) =>
                      setCalendarBalancesEur((prev) => ({ ...prev, [account.id]: e.target.value }))
                    }
                    placeholder="0,00"
                  />
                  <span className="fh-form-hint">
                    {t('onboarding.bankCalendarBalanceLabel', {
                      date: formatDisplayDate(calendarDashboardStartDate),
                    })}
                  </span>
                </label>
              );
            })}
          </section>
        ) : null}

        {step === 'manual-balances' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.manualBalancesTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.manualBalancesHint')}</p>
            <p className="fh-onboarding-hint">{t('onboarding.bankBalanceOberspartopfHint')}</p>
            {sortedOpeningBalanceAccounts.map((account) => {
              const parentName = account.parentAccountId
                ? accounts.find((a) => a.id === account.parentAccountId)?.name
                : null;
              return (
              <label key={account.id}>
                {account.name}
                {parentName ? ` (${parentName})` : ''}
                <input
                  value={manualBalancesEur[account.id] ?? ''}
                  onChange={(e) =>
                    setManualBalancesEur((prev) => ({ ...prev, [account.id]: e.target.value }))
                  }
                  placeholder="0,00"
                />
              </label>
              );
            })}
          </section>
        ) : null}

        {step === 'manual-income' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.manualIncomeTitle')}</h2>
            <p className="fh-onboarding-hint">{t('onboarding.manualIncomeHint')}</p>
            <label>
              {t('common.name')}
              <input value={manualIncomeName} onChange={(e) => setManualIncomeName(e.target.value)} />
            </label>
            <label>
              {t('common.amount')}
              <input value={manualIncomeEur} onChange={(e) => setManualIncomeEur(e.target.value)} placeholder="0,00" />
            </label>
            <label>
              {t('common.due')}
              <select value={manualDueRule} onChange={(e) => setManualDueRule(e.target.value as IncomeForecastDueRule)}>
                <option value="last_business_day">{t('dueRule.last_business_day')}</option>
                <option value="first_business_day">{t('dueRule.first_business_day')}</option>
                <option value="calendar_day">{t('dueRule.calendar_day')}</option>
              </select>
            </label>
          </section>
        ) : null}

        {step === 'review' ? (
          <section className="fh-onboarding-step">
            <h2>{t('onboarding.reviewTitle')}</h2>
            <ul className="fh-onboarding-list">
              <li>
                {t('onboarding.reviewMode')}: {setupMode === 'bank_import' ? t('onboarding.bankTitle') : t('onboarding.manualTitle')}
              </li>
              <li>
                {t('onboarding.reviewPeriod')}:{' '}
                {periodMode === 'since_last_salary'
                  ? t('settings.dashboard.sinceLastSalary')
                  : t('settings.dashboard.calendarMonth')}
              </li>
              <li>
                {t('onboarding.reviewAccounts')}: {accounts.map((a) => a.name).join(', ')}
              </li>
            </ul>
          </section>
        ) : null}

        <footer className="fh-onboarding-footer">
          {stepIndex > 0 ? (
            <button type="button" className="fh-btn ghost" disabled={busy} onClick={goBack}>
              {tView('common.back')}
            </button>
          ) : (
            <span />
          )}
          {step === 'review' ? (
            <button type="button" className="fh-btn primary" disabled={busy} onClick={finishSetup}>
              {busy ? t('common.loading') : t('onboarding.finish')}
            </button>
          ) : (
            <button type="button" className="fh-btn primary" disabled={busy} onClick={onContinueFromStep}>
              {onLanguageStep ? tEn('common.next') : t('common.next')}
            </button>
          )}
        </footer>
      </div>

      <AccountFormModal
        mode="create"
        open={accountModalOpen}
        allAccounts={accounts}
        onClose={() => setAccountModalOpen(false)}
        onSaved={async () => {
          setAccountModalOpen(false);
          await refreshAccounts();
        }}
        onError={setError}
      />

      <AccountFormModal
        mode="edit"
        open={Boolean(editAccount)}
        account={editAccount}
        allAccounts={accounts}
        onClose={() => setEditAccount(null)}
        onSaved={async () => {
          setEditAccount(null);
          await refreshAccounts();
        }}
        onError={setError}
      />
    </div>
  );
}
