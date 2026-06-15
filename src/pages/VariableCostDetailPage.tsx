import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { VariableCostDetailView } from '../components/variableCosts/VariableCostDetailView';
import { useUi } from '../lib/ui';
import { useLocale } from '../i18n/LocaleProvider';

export function VariableCostDetailPage() {
  const ui = useUi();
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  if (!id) {
    return <div>{t('variableCosts.notFound')}</div>;
  }

  return (
    <div style={ui.pageNarrow}>
      <Link to="/variable-kosten" style={{ color: ui.colors.textMuted, textDecoration: 'none', fontSize: 14 }}>
        ← {t('variableCosts.title')}
      </Link>

      <h2 style={{ marginTop: 8, marginBottom: 4, color: ui.colors.accentDark }}>
        {title || t('common.loading')}
      </h2>

      {error ? <div style={ui.errorBox}>{error}</div> : null}

      <VariableCostDetailView costId={id} onError={setError} onDetailLoaded={(detail) => setTitle(detail.cost.name)} />
    </div>
  );
}
