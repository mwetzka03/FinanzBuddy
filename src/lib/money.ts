function formatEurAbsFromCents(absCents: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absCents / 100);
}

export function formatEurFromCents(amountCents: number): string {
  return formatEurAbsFromCents(Math.abs(amountCents));
}

/** Signed balance (negative allowed, positive without leading +). */
export function formatBalanceEurFromCents(amountCents: number): string {
  if (amountCents < 0) {
    return `−${formatEurAbsFromCents(Math.abs(amountCents))}`;
  }
  return formatEurAbsFromCents(amountCents);
}

/** Signed amount for account ledger (+ income, − expense). */
export function formatSignedEurFromCents(amountCents: number): string {
  if (amountCents === 0) return formatEurAbsFromCents(0);
  const base = formatEurAbsFromCents(Math.abs(amountCents));
  return amountCents > 0 ? `+${base}` : `−${base}`;
}

export function formatExpenseEurFromCents(amountCents: number): string {
  return formatSignedEurFromCents(-Math.abs(amountCents));
}

export function formatIncomeEurFromCents(amountCents: number): string {
  return formatSignedEurFromCents(Math.abs(amountCents));
}

/** Signed EUR amount from a float (e.g. stock quotes). */
export function formatSignedEurAmount(amount: number): string {
  if (amount === 0) return formatEurAbsFromCents(0);
  const base = formatEurAbsFromCents(Math.round(Math.abs(amount) * 100));
  return amount > 0 ? `+${base}` : `−${base}`;
}

export function formatSignedPct(value: number): string {
  const prefix = value >= 0 ? '+' : '−';
  return `${prefix}${Math.abs(value).toFixed(2).replace('.', ',')} %`;
}

export function parseEurToCents(input: string): number {
  // Accept "1234,56", "1234.56", "1.234,56"
  const normalized = input
    .trim()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  if (!normalized) return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error('Ungültiger Betrag');
  return Math.round(value * 100);
}

