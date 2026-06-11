import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleProvider';

export function BrandLogo({ className }: { className?: string }) {
  const { t } = useLocale();
  const [logoOk, setLogoOk] = useState(true);

  return (
    <NavLink to="/" end className={className ?? 'fh-brand'}>
      {logoOk ? (
        <img src="/logo.png" alt="" className="fh-brand__logo" onError={() => setLogoOk(false)} />
      ) : (
        <div className="fh-brand__logo fh-brand__logo--fallback" aria-hidden>
          F
        </div>
      )}
      <div className="fh-brand__text">
        <strong className="fh-brand__title">{t('brand.name')}</strong>
        <span className="fh-brand__tagline">{t('brand.tagline')}</span>
      </div>
    </NavLink>
  );
}
