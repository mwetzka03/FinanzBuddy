import { DevTerminal } from './DevTerminal';
import { useDeveloperMode } from '../../lib/developerMode';

/** Festes Entwickler-Log-Dock (sichtbar bei aktivem Entwicklermodus). */
export function DeveloperLogDock() {
  const { enabled } = useDeveloperMode();
  if (!enabled) return null;

  return (
    <div className="fh-dev-log-dock" aria-label="Entwickler-Log">
      <DevTerminal defaultOpen />
    </div>
  );
}
