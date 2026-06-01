import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleProvider';
import { useDeveloperMode } from '../../lib/developerMode';
import {
  getStartupDevLogEntries,
  subscribeStartupDevLog,
  type DevLogEntry,
} from '../../lib/startupDevLog';

interface DevTerminalProps {
  defaultOpen?: boolean;
  alwaysExpanded?: boolean;
}

export function DevTerminal({ defaultOpen = false, alwaysExpanded = false }: DevTerminalProps) {
  const { t } = useLocale();
  const { enabled: devModeEnabled } = useDeveloperMode();
  const [open, setOpen] = useState(alwaysExpanded || defaultOpen || devModeEnabled);
  const [entries, setEntries] = useState<DevLogEntry[]>(() => getStartupDevLogEntries());

  useEffect(() => {
    if (devModeEnabled || alwaysExpanded) setOpen(true);
  }, [devModeEnabled, alwaysExpanded]);

  useEffect(() => subscribeStartupDevLog(setEntries), []);

  const showLog = alwaysExpanded || open;

  return (
    <div className="fh-startup-dev-terminal">
      {!alwaysExpanded && (
        <button
          type="button"
          className="fh-startup-dev-toggle"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={showLog}
        >
          <Terminal size={14} />
          <span>{t('devLog.title')}</span>
          <span className="fh-startup-dev-count">{entries.length}</span>
          {showLog ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      )}
      {alwaysExpanded && (
        <div className="fh-startup-dev-heading">
          <Terminal size={14} />
          <span>{t('devLog.title')}</span>
          <span className="fh-startup-dev-count">{entries.length}</span>
        </div>
      )}
      {showLog && (
        <pre className="fh-startup-dev-log" aria-live="polite">
          {entries.length === 0 && <span className="fh-startup-dev-empty">{t('devLog.empty')}</span>}
          {entries.map((entry) => {
            const contextLabels: Record<string, string> = {
              app: t('devLog.contexts.app'),
              navigation: t('devLog.contexts.navigation'),
              loading: t('devLog.contexts.loading'),
              backend: t('devLog.contexts.backend'),
            };
            const ctxLabel = entry.context ? contextLabels[entry.context] ?? entry.context : null;
            return (
              <div key={entry.id} className={`fh-startup-dev-line level-${entry.level}`}>
                <time>{entry.time}</time>
                {ctxLabel && <span className="fh-dev-log-ctx">[{ctxLabel}]</span>}
                <span>{entry.message}</span>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
