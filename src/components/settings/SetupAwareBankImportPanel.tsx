import { useEffect, useState } from 'react';
import { BankImportPanel } from './BankImportPanel';
import { getSetupState } from '../../tauri/api';
import { useLocale } from '../../i18n/LocaleProvider';

export function SetupAwareBankImportPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<'manual' | 'bank_import' | null | 'loading'>('loading');

  useEffect(() => {
    getSetupState()
      .then((s) => setMode(s.mode))
      .catch(() => setMode(null));
  }, []);

  if (mode === 'loading') return null;
  if (mode === 'manual') {
    return (
      <article className="fh-panel fh-settings-pref" style={embedded ? undefined : { marginTop: 24 }}>
        <p className="fh-panel-desc">{t('settings.bankImport.manualSetupBlocked')}</p>
      </article>
    );
  }
  return <BankImportPanel embedded={embedded} />;
}
