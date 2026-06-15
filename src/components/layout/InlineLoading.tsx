import { useMemo } from 'react';
import Lottie from 'lottie-react';
import baseAnimation from '../../assets/loading_anim.json';
import { useLocale } from '../../i18n/LocaleProvider';
import { themeLottieAnimation } from '../../lib/lottieTheme';
import { useTheme } from '../../lib/theme';

export function InlineLoading({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const { colors } = useTheme();
  const animationData = useMemo(
    () => themeLottieAnimation(baseAnimation, colors.accent, colors.accentDark, colors.accentSoft),
    [colors.accent, colors.accentDark, colors.accentSoft],
  );

  return (
    <div
      className={`fh-inline-loading${compact ? ' fh-inline-loading--compact' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={t('common.loading')}
    >
      <Lottie animationData={animationData} loop autoplay aria-hidden />
    </div>
  );
}
