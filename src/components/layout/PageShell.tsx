import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';
import { ErrorAlertDialog } from '../common/ErrorAlertDialog';

type PageShellProps = {
  title: string;
  intro?: ReactNode;
  error?: string | null;
  onErrorDismiss?: () => void;
  backTo?: string;
  backLabel?: string;
  narrow?: boolean;
  headerBefore?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function PageShell({
  title,
  intro,
  error,
  onErrorDismiss,
  backTo,
  backLabel,
  narrow,
  headerBefore,
  headerActions,
  children,
}: PageShellProps) {
  const ui = useUi();
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState('');

  const showError = !!error && error !== dismissed;

  return (
    <section style={narrow ? ui.pageNarrow : ui.page} className="fh-page">
      {backTo && (
        <Link to={backTo} style={ui.backLink} className="fh-back-link">
          ← {backLabel ?? t('common.back')}
        </Link>
      )}
      {headerBefore}
      <header className="fh-page-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>{title}</h1>
          {intro && (typeof intro === 'string' ? <p>{intro}</p> : intro)}
        </div>
        {headerActions ? <div className="fh-page-header-actions">{headerActions}</div> : null}
      </header>
      {children}
      <ErrorAlertDialog
        open={showError}
        message={error ?? ''}
        onClose={() => {
          setDismissed(error ?? '');
          onErrorDismiss?.();
        }}
      />
    </section>
  );
}
