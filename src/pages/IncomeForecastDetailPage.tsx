import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { IncomeForecastDetail, IsoDate } from '../lib/types';
import { AmountTable } from '../components/data/AmountTable';
import { SortableTh, sortByState, type SortState } from '../components/data/tableSort';
import { TdAmount } from '../components/data/AmountCells';
import { formatDisplayDate, isoToday, isoToMonth } from '../lib/date';
import { formatIncomeEurFromCents, parseEurToCents } from '../lib/money';
import { getIncomeForecastDetail, listIncomeForecastOccurrences, setIncomeForecastActual } from '../tauri/api';
import { useUi } from '../lib/ui';

const TABLE_COLS = '140px 120px 160px 100px';

export function IncomeForecastDetailPage() {
  const ui = useUi();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<IncomeForecastDetail | null>(null);
  const [occurrences, setOccurrences] = useState<IsoDate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState<string | null>(null);

  async function refresh() {
    if (!id) return;
    const data = await getIncomeForecastDetail(id);
    setDetail(data);
    const dates = await listIncomeForecastOccurrences(id);
    setOccurrences(dates);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const a of data.actuals) {
        next[a.occurrenceDate] = (a.amountCents / 100).toFixed(2).replace('.', ',');
      }
      for (const d of dates) {
        if (next[d] === undefined) next[d] = '';
      }
      return next;
    });
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const actualMap = useMemo(
    () => new Map(detail?.actuals.map((a) => [a.occurrenceDate, a.amountCents]) ?? []),
    [detail],
  );
  type OccurrenceSortKey = 'date' | 'forecast' | 'actual';
  const [sort, setSort] = useState<SortState<OccurrenceSortKey>>(null);
  const sortedOccurrences = useMemo(
    () =>
      sortByState(occurrences, sort, {
        date: (d) => d,
        forecast: () => detail?.forecast.amountCents ?? 0,
        actual: (d) => actualMap.get(d) ?? detail?.forecast.amountCents ?? 0,
      }),
    [occurrences, sort, actualMap, detail],
  );

  async function saveDate(occurrenceDate: IsoDate) {
    if (!id) return;
    setError(null);
    setSavingDate(occurrenceDate);
    try {
      const raw = drafts[occurrenceDate]?.trim() ?? '';
      if (!raw) {
        await setIncomeForecastActual({ id, occurrenceDate, amountCents: null });
      } else {
        await setIncomeForecastActual({ id, occurrenceDate, amountCents: parseEurToCents(raw) });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDate(null);
    }
  }

  if (!id) return <div>Eintrag nicht gefunden.</div>;
  if (!detail) return <div style={{ color: ui.colors.textMuted }}>Lade…</div>;

  const today = isoToday();

  return (
    <div style={ui.pageNarrow}>
      <Link to="/transaktionen?view=forecasts" style={{ color: ui.colors.textMuted, textDecoration: 'none', fontSize: 14 }}>
        ← Prognosen
      </Link>

      <h2 style={{ marginTop: 8, marginBottom: 4, color: ui.colors.accentDark }}>{detail.forecast.name}</h2>
      <p style={{ ...ui.pageIntro, marginTop: 0 }}>
        Prognose: <strong>{formatIncomeEurFromCents(detail.forecast.amountCents)}</strong> · Erste Zahlung{' '}
        {formatDisplayDate(detail.forecast.firstChargeDate)}
      </p>
      {error && <div style={ui.errorBox}>{error}</div>}

      <section style={ui.listPanel}>
        <h3 style={{ marginTop: 0 }}>Tatsächliche Beträge</h3>
        <p style={{ color: ui.colors.textMuted, fontSize: 13, marginTop: 0 }}>
          Leer lassen = Prognose. Ist-Betrag überschreibt die Prognose bei der Kontobuchung am Termin.
        </p>
        <AmountTable minWidth={540}>
            <div style={{ ...ui.tableHead, gridTemplateColumns: TABLE_COLS }}>
              <SortableTh label="Termin" sortKey="date" sort={sort} onSort={setSort} />
              <SortableTh
                label="Prognose"
                sortKey="forecast"
                sort={sort}
                onSort={setSort}
                style={ui.thAmount}
                align="right"
              />
              <SortableTh
                label="Tatsächlich"
                sortKey="actual"
                sort={sort}
                onSort={setSort}
                style={ui.thAmount}
                align="right"
              />
              <div />
            </div>
            {occurrences.length === 0 ? (
              <div style={ui.emptyRow}>Keine Termine.</div>
            ) : (
              sortedOccurrences.map((occurrenceDate) => {
                const booked = actualMap.has(occurrenceDate);
                const effective = booked ? actualMap.get(occurrenceDate)! : detail.forecast.amountCents;
                const isPast = occurrenceDate <= today;
                return (
                  <div key={occurrenceDate}>
                    <div style={{ ...ui.tableRow, gridTemplateColumns: TABLE_COLS }}>
                      <div style={ui.tdCenter}>{formatDisplayDate(occurrenceDate)}</div>
                      <TdAmount col="forecast" amountCents={detail.forecast.amountCents}>
                        {formatIncomeEurFromCents(detail.forecast.amountCents)}
                      </TdAmount>
                      <TdAmount col="actual" amountCents={effective}>
                        <input
                          value={drafts[occurrenceDate] ?? ''}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [occurrenceDate]: e.target.value }))}
                          placeholder="leer = Prognose"
                          style={{ ...ui.input, width: '100%', textAlign: 'center', background: 'transparent', border: 'none' }}
                        />
                      </TdAmount>
                      <div style={ui.tdActions}>
                        <button style={ui.btn} onClick={() => saveDate(occurrenceDate)} disabled={savingDate === occurrenceDate}>
                          {savingDate === occurrenceDate ? '…' : 'Speichern'}
                        </button>
                      </div>
                    </div>
                    {booked && isPast && (
                      <div style={ui.rowPreview}>
                        Gebucht: {formatIncomeEurFromCents(effective)} am {formatDisplayDate(occurrenceDate)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
        </AmountTable>
      </section>
    </div>
  );
}
