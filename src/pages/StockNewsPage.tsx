import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Account, StockNewsListResponse } from '../lib/types';
import { formatDisplayDateTime } from '../lib/date';
import { listAccounts, listStockNews, refreshStockNews } from '../tauri/api';
import { useUi } from '../lib/ui';
import { PageShell } from '../components/layout/PageShell';
import { ListPanel } from '../components/layout/ListPanel';
import { NewsCarouselRow } from '../components/stocks/NewsCarouselRow';
import { ReloadIconButton } from '../components/ReloadIconButton';

export function StockNewsPage() {
  const ui = useUi();
  const [data, setData] = useState<StockNewsListResponse | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [depotFilter, setDepotFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const depotAccounts = useMemo(
    () => accounts.filter((a) => a.balanceSource === 'stock_portfolio'),
    [accounts],
  );

  const loadNews = useCallback(async () => {
    setError(null);
    try {
      let response = await listStockNews(depotFilter || null);
      const empty = response.depotArticles.length + response.marketArticles.length === 0;
      if (!response.cachedAt || empty) {
        response = await refreshStockNews(depotFilter || null);
      }
      setData(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [depotFilter]);

  async function onManualRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await refreshStockNews(depotFilter || null);
      setData(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    listAccounts().then(setAccounts).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const hasArticles = (data?.depotArticles.length ?? 0) + (data?.marketArticles.length ?? 0) > 0;
  const initialLoading = !data;

  return (
    <PageShell
      title="Aktien · News"
      intro="Wirtschafts- und Marktmeldungen (DE/EN) der letzten 7 Tage — beim ersten Öffnen geladen, danach Cache alle 15 Minuten."
      error={error}
      headerActions={
        <ReloadIconButton
          label="News aktualisieren"
          onClick={onManualRefresh}
          disabled={refreshing || initialLoading}
        />
      }
    >
      {depotAccounts.length > 1 && (
        <div style={{ ...ui.toolbar, marginBottom: 16 }}>
          <label style={ui.field}>
            <span style={ui.label}>Depot</span>
            <select value={depotFilter} onChange={(e) => setDepotFilter(e.target.value)} style={ui.input}>
              <option value="">Alle Depots</option>
              {depotAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {data?.cachedAt && (
        <div style={{ fontSize: 12, color: ui.colors.textMuted, marginBottom: 12 }}>
          Stand: {formatDisplayDateTime(data.cachedAt)}
          {refreshing ? ' · Aktualisiere…' : null}
        </div>
      )}

      {initialLoading ? (
        <ListPanel hint="News werden beim ersten Öffnen dieser Ansicht geladen.">
          <div style={ui.emptyRow}>News werden geladen…</div>
        </ListPanel>
      ) : !hasArticles ? (
        <ListPanel hint="Keine passenden Meldungen in den letzten 7 Tagen.">
          <div style={ui.emptyRow}>Keine News gefunden.</div>
        </ListPanel>
      ) : (
        <ListPanel hint="Klick öffnet den Artikel im Browser. Mit ◀ ▶ durch alle News blättern.">
          <div style={{ padding: 16 }}>
            <NewsCarouselRow
              title="Dein Depot"
              hint="News zu Aktien in deinem Portfolio (Suche per Kürzel, Name oder ISIN)"
              articles={data?.depotArticles ?? []}
              emptyText="Keine depotbezogenen News — füge Aktien hinzu oder warte auf die nächste Aktualisierung."
            />
            <NewsCarouselRow
              title="Markt & Wirtschaft"
              hint="Allgemeine Börsen- und Wirtschaftsmeldungen (tagesschau, BBC, Reuters, …)"
              articles={data?.marketArticles ?? []}
              emptyText="Keine allgemeinen News in den letzten 7 Tagen."
            />
          </div>
        </ListPanel>
      )}
    </PageShell>
  );
}
