import { Languages, LayoutPanelLeft, Moon, Settings2, Sun, Terminal } from 'lucide-react';
import { useNavLayout, type NavLayout } from '../lib/layoutPreference';
import { DevTerminal } from '../components/common/DevTerminal';
import { AccountsSettingsPanel } from '../components/settings/AccountsSettingsPanel';
import { SetupAwareBankImportPanel } from '../components/settings/SetupAwareBankImportPanel';
import { DataManagementPanel } from '../components/settings/DataManagementPanel';
import { useLocale } from '../i18n/LocaleProvider';
import { LOCALES } from '../i18n/types';
import { useDeveloperMode } from '../lib/developerMode';
import { useTheme, type ThemeMode } from '../lib/theme';
import { PageShell } from '../components/layout/PageShell';

export function SettingsPage() {
  const { t, locale, setLocale } = useLocale();
  const { mode, setMode } = useTheme();
  const { enabled: devModeEnabled, setEnabled: setDevModeEnabled } = useDeveloperMode();
  const { layout: navLayout, setLayout: setNavLayout } = useNavLayout();

  return (
    <PageShell title={t('settings.title')} intro={t('settings.subtitle')}>
      <div className="fh-settings-header-grid">
        <article className="fh-panel fh-settings-pref fh-settings-grid-lang">
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

        <article className="fh-panel fh-settings-pref fh-settings-grid-appearance">
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

        <article className="fh-panel fh-settings-pref fh-settings-grid-nav">
          <header className="fh-panel-head">
            <LayoutPanelLeft size={18} aria-hidden />
            <h2>{t('settings.navigation.title')}</h2>
          </header>
          <p className="fh-panel-desc">{t('settings.navigation.desc')}</p>
          <div className="fh-settings-pref-actions">
            <div className="fh-segment stretch" role="group" aria-label={t('settings.navigation.title')}>
              {(['topbar', 'sidebar'] as NavLayout[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={navLayout === value ? 'active' : ''}
                  onClick={() => setNavLayout(value)}
                >
                  {value === 'topbar' ? t('settings.navigation.topbar') : t('settings.navigation.sidebar')}
                </button>
              ))}
            </div>
          </div>
        </article>

        <article className="fh-panel fh-settings-pref fh-settings-grid-dev">
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

        <div className="fh-settings-grid-data">
          <DataManagementPanel embedded />
        </div>

        <div className="fh-settings-grid-bank">
          <SetupAwareBankImportPanel embedded />
        </div>

        <article className="fh-panel fh-settings-pref fh-settings-grid-about fh-settings-about-compact">
          <header className="fh-panel-head">
            <Settings2 size={18} aria-hidden />
            <h2>{t('settings.about.title')}</h2>
          </header>
          <p className="fh-panel-desc">{t('settings.about.desc')}</p>
          <p className="fh-settings-about-credit">{t('settings.about.credit')}</p>
        </article>
      </div>

      <AccountsSettingsPanel />

      {devModeEnabled && (
        <article className="fh-panel fh-settings-dev-panel">
          <DevTerminal alwaysExpanded />
        </article>
      )}
    </PageShell>
  );
}
