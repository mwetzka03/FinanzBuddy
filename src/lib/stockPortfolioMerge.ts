import type { StockHoldingView, StockPortfolioSummary } from './types';

export function summarizeHoldings(holdings: StockHoldingView[]): StockPortfolioSummary {
  let totalCost = 0;
  let totalValue = 0;
  for (const row of holdings) {
    totalCost += row.costBasis;
    totalValue += row.currentValue ?? row.costBasis;
  }
  const totalGainLoss = totalValue - totalCost;
  const totalGainLossPct = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
  return {
    holdings,
    totalCostBasis: totalCost,
    totalCurrentValue: totalValue,
    totalGainLoss,
    totalGainLossPct,
  };
}

export function mergeHoldingIntoPortfolio(
  portfolio: StockPortfolioSummary,
  holding: StockHoldingView,
): StockPortfolioSummary {
  const holdings = [...portfolio.holdings];
  const idx = holdings.findIndex((row) => row.holding.id === holding.holding.id);
  if (idx >= 0) holdings[idx] = holding;
  else holdings.push(holding);
  holdings.sort((a, b) => a.holding.name.localeCompare(b.holding.name));
  return summarizeHoldings(holdings);
}

export function removeHoldingFromPortfolio(
  portfolio: StockPortfolioSummary,
  holdingId: string,
): StockPortfolioSummary {
  return summarizeHoldings(portfolio.holdings.filter((row) => row.holding.id !== holdingId));
}
