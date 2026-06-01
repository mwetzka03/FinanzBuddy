type Rgba = [number, number, number, number];

function hexToRgba(hex: string): Rgba {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
    1,
  ];
}

function isNeutralColor([r, g, b, a]: Rgba): boolean {
  if (a < 0.05) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08 && max > 0.75) return true;
  if (max < 0.12) return true;
  return false;
}

function walk(value: unknown, fn: (color: Rgba) => Rgba | null): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, fn));
  }
  if (!value || typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  if ((obj.ty === 'fl' || obj.ty === 'st') && obj.c && typeof obj.c === 'object') {
    const c = obj.c as { a?: number; k?: unknown };
    if (c.a === 0 && Array.isArray(c.k) && c.k.length === 4) {
      const current = c.k as Rgba;
      const next = fn(current);
      if (next) {
        return { ...obj, c: { ...c, k: next } };
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    out[key] = walk(child, fn);
  }
  return out;
}

/** Ersetzt farbige Lottie-Fills/Strokes durch App-Akzentfarben. */
export function themeLottieAnimation<T>(animation: T, accent: string, accentDark: string, accentSoft: string): T {
  const palette = [hexToRgba(accent), hexToRgba(accentDark), hexToRgba(accentSoft)];
  const seen = new Map<string, Rgba>();
  let cursor = 0;

  const mapped = walk(animation, (color) => {
    if (isNeutralColor(color)) return null;
    const key = color.map((v) => v.toFixed(3)).join(',');
    const existing = seen.get(key);
    if (existing) return existing;
    const next = palette[cursor % palette.length];
    cursor += 1;
    seen.set(key, next);
    return next;
  });

  return mapped as T;
}
