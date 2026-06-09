import type { Account, AccountKind } from './types';

export function isLedgerAccount(account: Account): boolean {
  return !isDepotAccount(account);
}

export function isMainAccountCandidate(account: Account): boolean {
  return isLedgerAccount(account) && effectiveAccountKind(account) === 'standard';
}

export function isBankImportAccount(account: Account): boolean {
  return isLedgerAccount(account);
}

export function isDepotAccount(account: Account): boolean {
  return effectiveAccountKind(account) === 'depot';
}

export function effectiveAccountKind(account: Pick<Account, 'accountKind' | 'balanceSource'>): AccountKind {
  if (account.balanceSource === 'stock_portfolio' || account.accountKind === 'depot') {
    return 'depot';
  }
  return account.accountKind ?? 'standard';
}

export function accountKindLabel(
  account: Pick<Account, 'accountKind' | 'balanceSource'>,
  t: (key: string) => string,
): string {
  switch (effectiveAccountKind(account)) {
    case 'depot':
      return t('accounts.kindDepot');
    case 'spartopf':
      return t('accounts.kindSpartopf');
    case 'oberspartopf':
      return t('accounts.kindOberspartopf');
    default:
      return t('accounts.kindStandard');
  }
}

export function normalizeIbanInput(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  return cleaned.length >= 8 ? cleaned : null;
}

export type AccountTreeRow = {
  account: Account;
  depth: number;
};

export function isOberspartopf(account: Pick<Account, 'accountKind' | 'balanceSource'>): boolean {
  return effectiveAccountKind(account) === 'oberspartopf';
}

/** Konten, die beim Setup einen Anfangssaldo brauchen (nie der Oberspartopf selbst). */
export function accountsRequiringOpeningBalance(accounts: Account[]): Account[] {
  return accounts.filter((a) => !isOberspartopf(a));
}

/** Hauptkonto, dann übrige Girokonten, dann Spartöpfe — jeweils alphabetisch. */
export function sortOpeningBalanceAccounts(accounts: Account[], mainAccountId?: string | null): Account[] {
  const targets = accountsRequiringOpeningBalance(accounts);
  const main = mainAccountId ? targets.find((a) => a.id === mainAccountId) : undefined;
  const rest = targets.filter((a) => a.id !== mainAccountId);
  const sortByName = (a: Account, b: Account) => a.name.localeCompare(b.name, 'de');
  const giro = rest.filter((a) => !isSpartopf(a)).sort(sortByName);
  const pots = rest.filter((a) => isSpartopf(a)).sort(sortByName);
  return [...(main ? [main] : []), ...giro, ...pots];
}

export function isSpartopf(account: Pick<Account, 'accountKind' | 'balanceSource'>): boolean {
  return effectiveAccountKind(account) === 'spartopf';
}

/** Spartopf or Oberspartopf — no Haupteinnahme import, no fix/var/buy dashboard cards. */
export function isSavingsPotAccount(account: Pick<Account, 'accountKind' | 'balanceSource'>): boolean {
  const kind = effectiveAccountKind(account);
  return kind === 'spartopf' || kind === 'oberspartopf';
}

export function buildAccountTreeRows(accounts: Account[]): AccountTreeRow[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  const byParent = new Map<string, Account[]>();
  const roots: Account[] = [];

  for (const account of accounts) {
    if (account.parentAccountId && accountIds.has(account.parentAccountId)) {
      const siblings = byParent.get(account.parentAccountId) ?? [];
      siblings.push(account);
      byParent.set(account.parentAccountId, siblings);
    } else {
      roots.push(account);
    }
  }

  const sortByName = (a: Account, b: Account) => a.name.localeCompare(b.name, 'de');
  roots.sort(sortByName);
  for (const children of byParent.values()) {
    children.sort(sortByName);
  }

  const rows: AccountTreeRow[] = [];
  function walk(account: Account, depth: number) {
    rows.push({ account, depth });
    for (const child of byParent.get(account.id) ?? []) {
      walk(child, depth + 1);
    }
  }
  for (const root of roots) {
    walk(root, 0);
  }
  return rows;
}
