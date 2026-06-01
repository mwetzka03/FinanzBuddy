import { parseEurToCents } from '../../lib/money';

export type LineDraft = { id?: string; name: string; amount: string };

export function parseLineDrafts(lines: LineDraft[]) {
  return lines
    .map((l) => ({ id: l.id, name: l.name.trim(), amountCents: parseEurToCents(l.amount) }))
    .filter((l) => l.name && l.amountCents > 0);
}

export function sumLineDraftCents(lines: LineDraft[]): number {
  return lines.reduce((sum, line) => {
    const raw = line.amount.trim();
    if (!raw) return sum;
    try {
      return sum + parseEurToCents(raw);
    } catch {
      return sum;
    }
  }, 0);
}
