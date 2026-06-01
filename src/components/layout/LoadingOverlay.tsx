import { useMemo } from 'react';
import Lottie from 'lottie-react';
import baseAnimation from '../../assets/loading_anim.json';
import { DevTerminal } from '../common/DevTerminal';
import { useLocale } from '../../i18n/LocaleProvider';
import { themeLottieAnimation } from '../../lib/lottieTheme';
import { useDeveloperMode } from '../../lib/developerMode';
import { useLoading } from '../../lib/loading';
import { useTheme } from '../../lib/theme';

export function LoadingOverlay() {
  const { t } = useLocale();
  const { colors } = useTheme();
  const { isLoading } = useLoading();
  const { enabled: devModeEnabled } = useDeveloperMode();

  const animationData = useMemo(
    () => themeLottieAnimation(baseAnimation, colors.accent, colors.accentDark, colors.accentSoft),
    [colors.accent, colors.accentDark, colors.accentSoft],
  );

  if (!isLoading) return null;

  return (
    <div className="fh-loading-overlay fh-loading-overlay-with-log" role="status" aria-live="polite" aria-label={t('common.loading')}>
      <div className="fh-loading-card fh-startup-card">
        <div className="fh-loading-lottie">
          <Lottie animationData={animationData} loop autoplay aria-hidden />
        </div>
        {devModeEnabled && <DevTerminal />}
      </div>
    </div>
  );
}
