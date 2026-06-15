import { useMemo } from 'react';
import { Modal } from './Modal';
import { useLocale } from '../../i18n/LocaleProvider';
import { buildErrorReport, downloadErrorReport } from '../../lib/errorReport';
import { useUi } from '../../lib/ui';

export function ErrorAlertDialog({
  open,
  message,
  cause,
  error,
  onClose,
}: {
  open: boolean;
  message: string;
  cause?: string;
  error?: unknown;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const ui = useUi();
  const report = useMemo(() => buildErrorReport(message, cause, error), [message, cause, error]);

  return (
    <Modal open={open} title={t('errors.title')} onClose={onClose}>
      <div className="fh-form">
        <p style={{ marginTop: 0 }}>{message}</p>
        {cause ? (
          <div style={{ fontSize: 13, color: ui.colors.textMuted, marginBottom: 12 }}>
            <strong>{t('errors.cause')}:</strong> {cause}
          </div>
        ) : null}
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose}>
            {t('common.close')}
          </button>
          <div className="fh-form-actions-right">
            <button
              type="button"
              className="fh-btn ghost"
              onClick={() => downloadErrorReport(report)}
            >
              {t('errors.export')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
