import { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleProvider';
import { getDashboardSettings, getSetupState } from '../../tauri/api';
import type { DashboardPeriodMode } from '../../lib/types';
import { DashboardSettingsPanel } from './DashboardSettingsPanel';

export function SetupAwareDashboardSettingsPanel() {
  const { t } = useLocale();
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [mode, setMode] = useState<DashboardPeriodMode>('calendar_month');

  useEffect(() => {
    Promise.all([getSetupState(), getDashboardSettings()])
      .then(([setup, settings]) => {
        setCompleted(setup.completed);
        setMode(settings.periodMode);
      })
      .catch(() => setCompleted(false));
  }, []);

  if (completed === null) return null;
  if (completed) {
    return (
      <article className="fh-panel fh-settings-pref">
        <header className="fh-panel-head">
          <CalendarRange size={18} aria-hidden />
          <h2>{t('settings.dashboard.title')}</h2>
        </header>
        <p className="fh-panel-desc">{t('settings.dashboard.lockedDesc')}</p>
        <p style={{ margin: 0, fontWeight: 600 }}>
          {mode === 'since_last_salary'
            ? t('settings.dashboard.sinceLastSalary')
            : t('settings.dashboard.calendarMonth')}
        </p>
      </article>
    );
  }
  return <DashboardSettingsPanel />;
}
