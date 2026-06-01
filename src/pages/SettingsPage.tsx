import { Languages, Moon, Settings2, Sun, Terminal } from 'lucide-react';
import { DevTerminal } from '../components/common/DevTerminal';
import { useLocale } from '../i18n/LocaleProvider';
import { LOCALES } from '../i18n/types';
import { useDeveloperMode } from '../lib/developerMode';
import { useTheme, type ThemeMode } from '../lib/theme';
import { PageShell } from '../components/layout/PageShell';

export function SettingsPage() {
  const { t, locale, setLocale } = useLocale();
  const { mode, setMode } = useTheme();
  const { enabled: devModeEnabled, setEnabled: setDevModeEnabled } = useDeveloperMode();

  return (
    <PageShell title={t('settings.title')} intro={t('settings.subtitle')}>
      <div className="fh-settings-prefs-grid">
        <article className="fh-panel fh-settings-pref">
          <header className="fh-panel-head">
            <Languages size={18} aria-hidden />
            <h2>{t('settings.language.title')}</h2>
          </header>
          <p className="fh-panel-desc">{t('settings.language.desc')}</p>
          <div className="fh-settings-pref-actions">
            <div className="fh-segment stretch" role="group" aria-label={t('settings.language.title')}>
              {LOCALES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={locale === l.id ? 'active' : ''}
                  onClick={() => setLocale(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </article>

        <article className="fh-panel fh-settings-pref">
          <header className="fh-panel-head">
            {mode === 'dark' ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />}
            <h2>{t('settings.appearance.title')}</h2>
          </header>
          <p className="fh-panel-desc">{t('settings.appearance.desc')}</p>
          <div className="fh-settings-pref-actions">
            <div className="fh-segment stretch" role="group" aria-label={t('settings.appearance.title')}>
              {(['light', 'dark'] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? 'active' : ''}
                  onClick={() => setMode(m)}
                >
                  {m === 'light' ? t('settings.appearance.light') : t('settings.appearance.dark')}
                </button>
              ))}
            </div>
          </div>
        </article>

        <article className="fh-panel fh-settings-pref">
          <header className="fh-panel-head">
            <Terminal size={18} aria-hidden />
            <h2>{t('settings.developerMode.title')}</h2>
          </header>
          <p className="fh-panel-desc">{t('settings.developerMode.desc')}</p>
          <div className="fh-settings-pref-actions">
            <div className="fh-segment stretch" role="group" aria-label={t('settings.developerMode.title')}>
              <button
                type="button"
                className={!devModeEnabled ? 'active' : ''}
                onClick={() => setDevModeEnabled(false)}
              >
                {t('common.off')}
              </button>
              <button
                type="button"
                className={devModeEnabled ? 'active' : ''}
                onClick={() => setDevModeEnabled(true)}
              >
                {t('common.on')}
              </button>
            </div>
          </div>
        </article>

        <article className="fh-panel fh-settings-pref">
          <header className="fh-panel-head">
            <Settings2 size={18} aria-hidden />
            <h2>{t('settings.about.title')}</h2>
          </header>
          <p className="fh-panel-desc">{t('settings.about.desc')}</p>
        </article>
      </div>

      {devModeEnabled && (
        <article className="fh-panel fh-settings-dev-panel">
          <DevTerminal alwaysExpanded />
        </article>
      )}
    </PageShell>
  );
}
