import { useCallback, useEffect, useRef, useState } from 'react';
import { DevTerminal } from './DevTerminal';
import { useDeveloperMode } from '../../lib/developerMode';

const STORAGE_KEY = 'fh-dev-log-dock-geometry';

type DockGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function loadGeometry(): DockGeometry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DockGeometry;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clampGeometry(geo: DockGeometry): DockGeometry {
  const margin = 16;
  const maxW = Math.max(280, window.innerWidth - margin * 2);
  const maxH = Math.max(120, window.innerHeight - margin * 2);
  return {
    x: Math.min(Math.max(margin, geo.x), window.innerWidth - margin - 120),
    y: Math.min(Math.max(margin, geo.y), window.innerHeight - margin - 80),
    width: Math.min(Math.max(280, geo.width), maxW),
    height: Math.min(Math.max(120, geo.height), maxH),
  };
}

/** Verschiebbares und skalierbares Entwickler-Log-Dock. */
export function DeveloperLogDock() {
  const { enabled } = useDeveloperMode();
  const saved = loadGeometry();
  const [geometry, setGeometry] = useState<DockGeometry>(() =>
    clampGeometry(
      saved ?? {
        x: Math.max(16, window.innerWidth - 536),
        y: Math.max(16, window.innerHeight - 320),
        width: 520,
        height: 280,
      },
    ),
  );
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry));
  }, [geometry]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setGeometry((prev) =>
      clampGeometry({
        ...prev,
        x: dragRef.current!.originX + dx,
        y: dragRef.current!.originY + dy,
      }),
    );
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: geometry.x,
        originY: geometry.y,
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [geometry.x, geometry.y, onPointerMove, onPointerUp],
  );

  if (!enabled) return null;

  return (
    <div
      className="fh-dev-log-dock"
      aria-label="Entwickler-Log"
      style={{
        left: geometry.x,
        top: geometry.y,
        right: 'auto',
        bottom: 'auto',
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <div
        className="fh-dev-log-dock-handle"
        onPointerDown={onPointerDown}
        role="presentation"
        title="Verschieben"
      />
      <DevTerminal defaultOpen />
    </div>
  );
}
