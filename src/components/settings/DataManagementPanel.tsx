import { useState } from 'react';
import { Download, Eraser, RotateCcw, Trash2, Upload } from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useLocale } from '../../i18n/LocaleProvider';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { clearAllTransactions, exportUserData, importUserData, resetAllUserData } from '../../tauri/api';

type PendingAction = 'clearTransactions' | 'resetApp' | null;

export function DataManagementPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | 'transactions' | 'all' | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  async function onExport() {
    setError(null);
    setSuccess(null);
    const filePath = await save({
      defaultPath: `finanzbuddy-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'FinanzBuddy Backup', extensions: ['json'] }],
    });
    if (!filePath || Array.isArray(filePath)) return;
    setBusy('export');
    try {
      const result = await exportUserData(filePath);
      setSuccess(t('settings.data.exportSuccess', { message: result.message }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onImport() {
    if (!window.confirm(t('settings.data.importConfirm'))) return;
    setError(null);
    setSuccess(null);
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'FinanzBuddy Backup', extensions: ['json'] }],
    });
    if (!filePath || Array.isArray(filePath)) return;
    setBusy('import');
    try {
      const result = await importUserData(filePath);
      setSuccess(t('settings.data.importSuccess', { message: result.message }));
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runClearTransactions() {
    setError(null);
    setSuccess(null);
    setBusy('transactions');
    try {
      await clearAllTransactions();
      setSuccess(t('settings.data.clearTransactions'));
      setPendingAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runResetAll() {
    setError(null);
    setSuccess(null);
    setBusy('all');
    try {
      await resetAllUserData();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <>
      <article className={`fh-panel fh-settings-pref${embedded ? '' : ''}`} style={embedded ? undefined : { marginTop: 24 }}>
        <header className="fh-panel-head">
          <Trash2 size={18} aria-hidden />
          <h2>{t('settings.data.title')}</h2>
        </header>
        <p className="fh-panel-desc">{t('settings.data.desc')}</p>
        <p className="fh-panel-desc">{t('settings.data.periodResetHint')}</p>
        {error ? <p style={{ color: 'var(--fh-danger, #dc2626)', marginTop: 0 }}>{error}</p> : null}
        {success ? <p style={{ color: 'var(--fh-success, #16a34a)', marginTop: 0 }}>{success}</p> : null}
        <div className="fh-settings-pref-actions fh-settings-data-actions">
          <button type="button" className="fh-btn ghost" disabled={busy !== null} onClick={onExport}>
            <Download size={16} aria-hidden />
            {busy === 'export' ? t('common.loading') : t('settings.data.exportData')}
          </button>
          <button type="button" className="fh-btn ghost" disabled={busy !== null} onClick={onImport}>
            <Upload size={16} aria-hidden />
            {busy === 'import' ? t('common.loading') : t('settings.data.importData')}
          </button>
          <button
            type="button"
            className="fh-btn ghost"
            disabled={busy !== null}
            onClick={() => setPendingAction('clearTransactions')}
          >
            <Eraser size={16} aria-hidden />
            {busy === 'transactions' ? t('common.loading') : t('settings.data.clearTransactions')}
          </button>
          <button type="button" className="fh-btn ghost" disabled={busy !== null} onClick={() => setPendingAction('resetApp')}>
            <RotateCcw size={16} aria-hidden />
            {busy === 'all' ? t('common.loading') : t('settings.data.resetApp')}
          </button>
        </div>
      </article>

      <ConfirmDialog
        open={pendingAction === 'clearTransactions'}
        message={t('settings.data.clearTransactionsConfirm')}
        confirmLabel={t('settings.data.clearTransactions')}
        danger
        busy={busy === 'transactions'}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runClearTransactions()}
      />

      <ConfirmDialog
        open={pendingAction === 'resetApp'}
        message={t('settings.data.resetAppConfirm')}
        confirmLabel={t('settings.data.resetApp')}
        danger
        busy={busy === 'all'}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runResetAll()}
      />
    </>
  );
}
