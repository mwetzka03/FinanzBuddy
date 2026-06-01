import { isDeveloperModeEnabled } from './developerMode';

export type DevLogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface DevLogEntry {
  id: string;
  time: string;
  level: DevLogLevel;
  message: string;
  context?: string;
}

let nextId = 0;
const entries: DevLogEntry[] = [];
const listeners = new Set<(entries: DevLogEntry[]) => void>();

function notify() {
  listeners.forEach((listener) => listener([...entries]));
}

export function devLog(message: string, level: DevLogLevel = 'info', context?: string): void {
  if (!isDeveloperModeEnabled() && level !== 'error') {
    return;
  }
  const entry: DevLogEntry = {
    id: String(++nextId),
    time: new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    level,
    message,
    context,
  };
  entries.push(entry);
  if (entries.length > 400) entries.shift();
  notify();
}

export function getStartupDevLogEntries(): DevLogEntry[] {
  return [...entries];
}

export function subscribeStartupDevLog(listener: (entries: DevLogEntry[]) => void): () => void {
  listeners.add(listener);
  listener([...entries]);
  return () => listeners.delete(listener);
}

export function clearStartupDevLog(): void {
  entries.length = 0;
  notify();
}
