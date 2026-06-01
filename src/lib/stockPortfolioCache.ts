import type { StockPortfolioSummary } from './types';

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
