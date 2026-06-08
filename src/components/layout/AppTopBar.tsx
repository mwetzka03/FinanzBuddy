import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleProvider';
import { findActiveNavParent, isNavSectionActive, NAV_SECTIONS } from '../../lib/nav';

export function AppTopBar() {
  const { t } = useLocale();
  const location = useLocation();
  const [logoOk, setLogoOk] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const hoveredSection = useMemo(
    () => NAV_SECTIONS.find((s) => s.id === hoveredId && s.items?.length),
    [hoveredId],
  );

  useEffect(() => {
    setHoveredId(findActiveNavParent(location.pathname)?.id ?? null);
  }, [location.pathname]);

  return (
    <header
      className="fh-topbar"
      onMouseLeave={() => setHoveredId(findActiveNavParent(location.pathname)?.id ?? null)}
    >
      <div className="fh-topbar__main">
        <NavLink to="/" end className="fh-topbar__brand">
          {logoOk ? (
            <img src="/logo.png" alt="" className="fh-topbar__logo" onError={() => setLogoOk(false)} />
          ) : (
            <div className="fh-topbar__logo fh-topbar__logo--fallback" aria-hidden>
              F
            </div>
          )}
          <div className="fh-topbar__brand-text">
            <strong className="fh-topbar__brand-title">{t('brand.name')}</strong>
            <span className="fh-topbar__brand-tagline">{t('brand.tagline')}</span>
          </div>
        </NavLink>

        <nav className="fh-topbar__nav" aria-label="Hauptnavigation">
          {NAV_SECTIONS.map((section) => {
            const active = isNavSectionActive(section, location.pathname);
            const SectionIcon = section.icon;
            if (section.to) {
              return (
                <NavLink
                  key={section.id}
                  to={section.to}
                  end={section.end}
                  className={({ isActive }) => (isActive || active ? 'active' : undefined)}
                >
                  <SectionIcon size={18} aria-hidden />
                  <span>{t(section.labelKey)}</span>
                </NavLink>
              );
            }
            return (
              <button
                key={section.id}
                type="button"
                className={active || hoveredId === section.id ? 'active' : undefined}
                onMouseEnter={() => setHoveredId(section.id)}
                onFocus={() => setHoveredId(section.id)}
              >
                <SectionIcon size={18} aria-hidden />
                <span>{t(section.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="fh-topbar__actions">
          <NavLink
            to="/settings"
            className={({ isActive }) => `fh-topbar-settings${isActive ? ' active' : ''}`}
            aria-label={t('nav.settingsAria')}
            title={t('nav.settings')}
          >
            <Settings size={22} aria-hidden />
          </NavLink>
        </div>
      </div>

      {hoveredSection?.items ? (
        <nav className="fh-topbar__subnav" aria-label="Unternavigation">
          {hoveredSection.items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {ItemIcon ? <ItemIcon size={16} aria-hidden /> : null}
                <span>{t(item.labelKey)}</span>
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
