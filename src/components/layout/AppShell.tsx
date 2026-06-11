import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Moon, Settings, Sun } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleProvider';
import { findActiveNavParent, isNavSectionActive, NAV_SECTIONS } from '../../lib/nav';
import { useNavLayout } from '../../lib/layoutPreference';
import { useTheme } from '../../lib/theme';
import { BrandLogo } from './BrandLogo';

function useTopBarNavHover() {
  const location = useLocation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const hoveredSection = useMemo(
    () => NAV_SECTIONS.find((s) => s.id === hoveredId && s.items?.length),
    [hoveredId],
  );

  useEffect(() => {
    setHoveredId(findActiveNavParent(location.pathname)?.id ?? null);
  }, [location.pathname]);

  const resetHover = () => setHoveredId(findActiveNavParent(location.pathname)?.id ?? null);

  return { hoveredId, setHoveredId, hoveredSection, resetHover };
}

function AppTopBarPrimaryNav({
  hoveredId,
  setHoveredId,
  resetHover,
}: {
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  resetHover: () => void;
}) {
  const { t } = useLocale();
  const location = useLocation();

  return (
    <nav className="fh-topbar__nav" aria-label="Hauptnavigation" onMouseLeave={resetHover}>
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
  );
}

function AppTopBarSubnav({ sectionId }: { sectionId: string }) {
  const { t } = useLocale();
  const section = NAV_SECTIONS.find((s) => s.id === sectionId);
  if (!section?.items?.length) return null;

  return (
    <nav className="fh-topbar__subnav" aria-label="Unternavigation">
      {section.items.map((item) => {
        const ItemIcon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {ItemIcon ? <ItemIcon size={16} aria-hidden /> : null}
            <span>{t(item.labelKey)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function AppNavSections({ variant }: { variant: 'topbar' | 'sidebar' }) {
  const { t } = useLocale();
  const location = useLocation();

  if (variant === 'topbar') {
    return null;
  }

  return (
    <nav className="fh-sidebar__nav" aria-label="Hauptnavigation">
      {NAV_SECTIONS.map((section) => {
        const active = isNavSectionActive(section, location.pathname);
        const SectionIcon = section.icon;
        if (section.to) {
          return (
            <NavLink
              key={section.id}
              to={section.to}
              end={section.end}
              className={({ isActive }) => `fh-sidebar__link${isActive || active ? ' active' : ''}`}
            >
              <SectionIcon size={18} aria-hidden />
              <span>{t(section.labelKey)}</span>
            </NavLink>
          );
        }
        return (
          <div key={section.id} className={`fh-sidebar__group${active ? ' fh-sidebar__group--active' : ''}`}>
            <div className="fh-sidebar__group-label">
              <SectionIcon size={16} aria-hidden />
              <span>{t(section.labelKey)}</span>
            </div>
            <div className="fh-sidebar__sub">
              {section.items?.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `fh-sidebar__sublink${isActive ? ' active' : ''}`}
                  >
                    {ItemIcon ? <ItemIcon size={15} aria-hidden /> : null}
                    <span>{t(item.labelKey)}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function AppNavActions({ className }: { className?: string }) {
  const { t } = useLocale();
  const { mode, toggle } = useTheme();

  return (
    <div className={className}>
      <button
        type="button"
        className="fh-theme-btn"
        onClick={toggle}
        aria-label={mode === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
        title={mode === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
      >
        {mode === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
      </button>
      <NavLink
        to="/settings"
        className={({ isActive }) => `fh-topbar-settings${isActive ? ' active' : ''}`}
        aria-label={t('nav.settingsAria')}
        title={t('nav.settings')}
      >
        <Settings size={22} aria-hidden />
      </NavLink>
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside className="fh-sidebar">
      <BrandLogo className="fh-sidebar__brand fh-brand" />
      <AppNavSections variant="sidebar" />
      <div className="fh-sidebar__footer">
        <AppNavActions className="fh-sidebar__actions" />
      </div>
    </aside>
  );
}

export function AppTopBar() {
  const { hoveredId, setHoveredId, hoveredSection, resetHover } = useTopBarNavHover();

  return (
    <header className="fh-topbar">
      <div className="fh-topbar__main">
        <BrandLogo className="fh-topbar__brand fh-brand" />
        <AppTopBarPrimaryNav hoveredId={hoveredId} setHoveredId={setHoveredId} resetHover={resetHover} />
        <AppNavActions className="fh-topbar__actions" />
      </div>
      {hoveredSection ? <AppTopBarSubnav sectionId={hoveredSection.id} /> : null}
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { layout } = useNavLayout();

  return (
    <>
      {layout === 'sidebar' ? <AppSidebar /> : <AppTopBar />}
      <main className={layout === 'sidebar' ? 'fh-main fh-main--sidebar fh-main-with-overlay' : 'fh-main fh-main-with-overlay'}>
        {children}
      </main>
    </>
  );
}
