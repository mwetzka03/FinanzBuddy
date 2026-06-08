import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isDeveloperModeEnabled } from './developerMode';
import { devLog } from './startupDevLog';

interface CalcLogPayload {
  class: string;
  method: string;
  message: string;
}

export function useCalcLogBridge(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<CalcLogPayload>('calc-log', (event) => {
      if (!isDeveloperModeEnabled()) return;
      const { class: cls, method, message } = event.payload;
      devLog(`[${cls}]: [${method}]: ${message}`, 'info', 'calc');
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
