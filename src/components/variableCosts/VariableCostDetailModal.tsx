import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { useUi } from '../../lib/ui';
import { useLocale } from '../../i18n/LocaleProvider';
import { VariableCostDetailView } from './VariableCostDetailView';

type Props = {
  open: boolean;
  costId: string | null;
  onClose: () => void;
};

export function VariableCostDetailModal({ open, costId, onClose }: Props) {
  const ui = useUi();
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (open) setTitle('');
  }, [costId, open]);

  if (!costId) return null;

  return (
    <Modal open={open} bleed title={title || t('common.loading')} onClose={onClose}>
      {error ? <div style={ui.errorBox}>{error}</div> : null}
      <VariableCostDetailView
        costId={costId}
        onError={setError}
        onDetailLoaded={(detail) => setTitle(detail.cost.name)}
      />
    </Modal>
  );
}
