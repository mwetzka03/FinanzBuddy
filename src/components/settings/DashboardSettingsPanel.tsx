import { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleProvider';
import { getDashboardSettings, setDashboardPeriodMode } from '../../tauri/api';
import type { DashboardPeriodMode } from '../../lib/types';

export function DashboardSettingsPanel() {
  const { t } = useLocale();
  const [mode, setMode] = useState<DashboardPeriodMode>('calendar_month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardSettings()
      .then((s) => setMode(s.periodMode))
      .finally(() => setLoading(false));
  }, []);

  async function onChange(next: DashboardPeriodMode) {
    setMode(next);
    await setDashboardPeriodMode(next);
  }

  return (
    <article className="fh-panel fh-settings-pref">
      <header className="fh-panel-head">
        <CalendarRange size={18} aria-hidden />
        <h2>{t('settings.dashboard.title')}</h2>
      </header>
      <p className="fh-panel-desc">{t('settings.dashboard.desc')}</p>
      <div className="fh-settings-pref-actions">
        <div className="fh-segment stretch" role="group" aria-label={t('settings.dashboard.title')}>
          <button
            type="button"
            className={mode === 'calendar_month' ? 'active' : ''}
            disabled={loading}
            onClick={() => onChange('calendar_month')}
          >
            {t('settings.dashboard.calendarMonth')}
          </button>
          <button
            type="button"
            className={mode === 'since_last_salary' ? 'active' : ''}
            disabled={loading}
            onClick={() => onChange('since_last_salary')}
          >
            {t('settings.dashboard.sinceLastSalary')}
          </button>
        </div>
      </div>
    </article>
  );
}
