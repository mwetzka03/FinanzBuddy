import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { useLocale } from '../../i18n/LocaleProvider';

type ConfirmDialogProps = {
  open: boolean;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLocale();

  return (
    <Modal open={open} title={t('common.confirmTitle')} onClose={onCancel}>
      <p className="fh-form-hint" style={{ marginTop: 0 }}>
        {message}
      </p>
      <div className="fh-form-actions">
        <button type="button" className="fh-btn ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel ?? t('common.cancel')}
        </button>
        <div className="fh-form-actions-right">
          <button
            type="button"
            className={danger ? 'fh-btn danger' : 'fh-btn primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('common.loading') : (confirmLabel ?? t('common.confirm'))}
          </button>
        </div>
      </div>
    </Modal>
  );
}
