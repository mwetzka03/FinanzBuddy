import type { StockHoldingView, StockPortfolioSummary } from './types';
import { mergeHoldingIntoPortfolio, removeHoldingFromPortfolio } from './stockPortfolioMerge';

/** Entspricht portfolio_cache::REFRESH_INTERVAL (10 Minuten). */
export const STOCK_PORTFOLIO_CACHE_MS = 10 * 60 * 1000;

type CacheEntry = {
  filter: string;
  data: StockPortfolioSummary;
  fetchedAt: number;
};

let cache: CacheEntry | null = null;

export function readStockPortfolioCache(filter: string): StockPortfolioSummary | null {
  if (!cache || cache.filter !== filter) return null;
  if (Date.now() - cache.fetchedAt > STOCK_PORTFOLIO_CACHE_MS) return null;
  return cache.data;
}

export function writeStockPortfolioCache(filter: string, data: StockPortfolioSummary): void {
  cache = { filter, data, fetchedAt: Date.now() };
}

export function clearStockPortfolioCache(): void {
  cache = null;
}

export function patchStockPortfolioCache(holding: StockHoldingView): void {
  if (!cache) return;
  cache = {
    ...cache,
    data: mergeHoldingIntoPortfolio(cache.data, holding),
    fetchedAt: Date.now(),
  };
}

export function removeFromStockPortfolioCache(holdingId: string): void {
  if (!cache) return;
  cache = {
    ...cache,
    data: removeHoldingFromPortfolio(cache.data, holdingId),
    fetchedAt: Date.now(),
  };
}
