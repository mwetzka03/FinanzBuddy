import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

type PageShellProps = {
  title: string;
  intro?: ReactNode;
  error?: string | null;
  backTo?: string;
  backLabel?: string;
  narrow?: boolean;
  headerBefore?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, intro, error, backTo, backLabel, narrow, headerBefore, headerActions, children }: PageShellProps) {
  const ui = useUi();
  const { t } = useLocale();

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
      {error && (
        <div style={ui.errorBox} role="alert" className="fh-alert">
          {error}
        </div>
      )}
      {children}
    </section>
  );
}
