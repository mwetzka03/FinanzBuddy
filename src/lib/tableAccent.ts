import type { CSSProperties } from 'react';
import type { TimelineEvent } from './types';
import type { UnifiedEntry } from './transactionList';

export const STOCK_BUY_ACCENT = '#f59e0b';
export const STOCK_SELL_ACCENT = '#10b981';

export function isStockPurchaseEvent(ev: Pick<TimelineEvent, 'type' | 'title'>): boolean {
  return ev.type === 'stock_purchase' || ev.title.startsWith('Aktienkauf:');
}

export function isStockSaleEvent(ev: Pick<TimelineEvent, 'type' | 'title'>): boolean {
  return ev.type === 'stock_sale' || ev.title.startsWith('Aktienverkauf:');
}

export function isStockPurchaseEntry(entry: Pick<UnifiedEntry, 'displayKind' | 'title' | 'ledger'>): boolean {
  if (entry.ledger?.sourceId?.startsWith('stock_lot:')) return true;
  return entry.displayKind === 'expense' && entry.title.startsWith('Aktienkauf:');
}

export function isStockSaleEntry(entry: Pick<UnifiedEntry, 'displayKind' | 'title' | 'ledger'>): boolean {
  if (entry.ledger?.sourceId?.startsWith('stock_sale:')) return true;
  return entry.displayKind === 'income' && entry.title.startsWith('Aktienverkauf:');
}

export function stockAccentColor(
  item: Pick<TimelineEvent, 'type' | 'title'> | Pick<UnifiedEntry, 'displayKind' | 'title' | 'ledger'>,
): string | null {
  if ('type' in item) {
    if (isStockPurchaseEvent(item)) return STOCK_BUY_ACCENT;
    if (isStockSaleEvent(item)) return STOCK_SELL_ACCENT;
    return null;
  }
  if (isStockPurchaseEntry(item)) return STOCK_BUY_ACCENT;
  if (isStockSaleEntry(item)) return STOCK_SELL_ACCENT;
  return null;
}

export function tableRowAccentStyle(color: string, bgCard: string): CSSProperties {
  return {
    borderLeft: `4px solid ${color}`,
    background: `color-mix(in srgb, ${color} 12%, ${bgCard})`,
  };
}
