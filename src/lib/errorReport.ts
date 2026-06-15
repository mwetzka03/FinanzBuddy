import { getStartupDevLogEntries } from './startupDevLog';

export type ErrorReport = {
  exportedAt: string;
  route: string;
  message: string;
  cause?: string;
  stack?: string;
  userAgent: string;
  devLog: ReturnType<typeof getStartupDevLogEntries>;
};

export function buildErrorReport(message: string, cause?: string, error?: unknown): ErrorReport {
  const stack = error instanceof Error ? error.stack : undefined;
  return {
    exportedAt: new Date().toISOString(),
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    message,
    cause,
    stack,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    devLog: getStartupDevLogEntries(),
  };
}

export function downloadErrorReport(report: ErrorReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `finanzbuddy-error-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
