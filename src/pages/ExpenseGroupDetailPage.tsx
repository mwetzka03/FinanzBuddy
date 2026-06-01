import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ExpenseGroupDetail, IsoDate } from '../lib/types';
import { isoToday } from '../lib/date';
import { formatEurFromCents, parseEurToCents } from '../lib/money';
import { getExpenseGroup, updateExpenseGroup } from '../tauri/api';
import { useUi } from '../lib/ui';
import { DateInput } from '../components/DateInput';
import { OptionalDescriptionInput } from '../components/OptionalDescriptionInput';

type LineDraft = { id?: string; name: string; amount: string };

export function ExpenseGroupDetailPage() {
  const ui = useUi();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ExpenseGroupDetail | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState<IsoDate>(() => isoToday());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    if (!id) return;
    const data = await getExpenseGroup(id);
    setDetail(data);
    setName(data.group.name);
    setDate(data.group.date ?? isoToday());
    setNotes(data.group.notes ?? '');
    setLines(
      data.lines.map((l) => ({
        id: l.id,
        name: l.name,
        amount: (l.amountCents / 100).toFixed(2).replace('.', ','),
      })),
    );
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const totalCents = lines.reduce((sum, l) => {
    const raw = l.amount.trim();
    if (!raw) return sum;
    try {
      return sum + parseEurToCents(raw);
    } catch {
      return sum;
    }
  }, 0);

  function addLine() {
    setLines((prev) => [...prev, { name: '', amount: '' }]);
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function onSave() {
    if (!id) return;
    setError(null);
    setSaving(true);
    try {
      const parsed = lines
        .map((l) => ({
          id: l.id,
          name: l.name.trim(),
          amountCents: parseEurToCents(l.amount),
        }))
        .filter((l) => l.name && l.amountCents > 0);
      if (!name.trim() || parsed.length === 0) return;
      await updateExpenseGroup({
        id,
        name: name.trim(),
        date,
        notes: notes.trim() || null,
        lines: parsed,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!detail) {
    return <div style={{ color: ui.colors.textMuted }}>Lade…</div>;
  }

  return (
    <div style={ui.pageNarrow}>
      <Link to="/ausgabengruppen" style={{ color: ui.colors.textMuted, textDecoration: 'none', fontSize: 14 }}>
        ← Ausgabengruppen
      </Link>
      <h2 style={{ marginTop: 8, color: ui.colors.accentDark }}>{detail.group.name}</h2>
      {error && <div style={ui.errorBox}>{error}</div>}

      <section style={ui.formPanel}>
        <div style={ui.formGrid}>
          <label style={{ ...ui.field, gridColumn: 'span 2' }}>
            <span style={ui.label}>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} style={ui.input} />
            <OptionalDescriptionInput value={notes} onChange={setNotes} />
          </label>
          <label style={ui.field}>
            <span style={ui.label}>Datum</span>
            <DateInput value={date} onChange={setDate} />
          </label>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ ...ui.label, marginBottom: 8 }}>Einzelposten</div>
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input
                value={line.name}
                onChange={(e) => updateLine(idx, { name: e.target.value })}
                style={{ ...ui.input, flex: 1 }}
              />
              <input
                value={line.amount}
                onChange={(e) => updateLine(idx, { amount: e.target.value })}
                style={{ ...ui.input, width: 110, textAlign: 'right' }}
              />
              <button style={ui.btn} onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                −
              </button>
            </div>
          ))}
          <button style={ui.btn} onClick={addLine}>
            + Posten
          </button>
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Gesamt: {formatEurFromCents(totalCents)}</div>
          <button style={ui.btnPrimary} onClick={onSave} disabled={saving}>
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </section>
    </div>
  );
}
