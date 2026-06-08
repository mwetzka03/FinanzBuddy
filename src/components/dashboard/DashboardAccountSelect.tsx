import { useMemo, useState } from 'react';
import type { Account } from '../../lib/types';
import { buildAccountTreeRows, effectiveAccountKind, isOberspartopf } from '../../lib/accounts';
import { useLocale } from '../../i18n/LocaleProvider';
import { useUi } from '../../lib/ui';

function accountIcon(a: Account | null): string {
  if (!a) return '◉';
  if (effectiveAccountKind(a) === 'depot') return '📈';
  if (a.isMain) return '★';
  if (isOberspartopf(a)) return '🗂️';
  if (effectiveAccountKind(a) === 'spartopf') return '🫙';
  if (a.isLiquid) return '💧';
  return '🏦';
}

function accountSubtitle(a: Account | null, t: (key: string) => string): string {
  if (!a) return t('common.overview');
  if (effectiveAccountKind(a) === 'depot') return t('common.stockDepot');
  if (isOberspartopf(a)) return t('accounts.oberspartopfAggregate');
  if (a.isMain) return t('common.mainAccountLabel');
  if (effectiveAccountKind(a) === 'spartopf') return t('accounts.kindSpartopf');
  if (a.isLiquid) return t('common.liquidAccount');
  return t('common.accountGeneric');
}

function accountSubtitleShort(a: Account, t: (key: string) => string): string {
  if (effectiveAccountKind(a) === 'depot') return t('common.depot');
  if (isOberspartopf(a)) return t('accounts.oberspartopfAggregate');
  if (a.isMain) return t('common.mainAccountLabel');
  if (effectiveAccountKind(a) === 'spartopf') return t('accounts.kindSpartopf');
  if (a.isLiquid) return t('common.liquidAccount');
  return t('common.accountGeneric');
}

export function DashboardAccountSelect(props: {
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
  showAllOption?: boolean;
}) {
  const ui = useUi();
  const { t } = useLocale();
  const { colors } = ui;
  const [open, setOpen] = useState(false);
  const showAllOption = props.showAllOption ?? true;

  const treeRows = useMemo(() => buildAccountTreeRows(props.accounts), [props.accounts]);

  const selected = useMemo(
    () => (props.value ? props.accounts.find((a) => a.id === props.value) ?? null : null),
    [props.accounts, props.value],
  );

  const label = selected?.name ?? t('common.allAccounts');

  return (
    <div style={{ position: 'relative', flex: '1 1 360px', minWidth: 320, maxWidth: 560 }}>
      <div style={{ ...ui.label, marginBottom: 6, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {t('dashboard.accountLabel')}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 14,
          border: `1px solid ${open ? colors.accent : colors.border}`,
          background: `linear-gradient(180deg, ${colors.bgCard} 0%, ${colors.bgMuted} 100%)`,
          color: colors.text,
          cursor: 'pointer',
          boxShadow: open ? `0 0 0 3px ${colors.accentSoft}` : '0 4px 14px rgba(15, 23, 42, 0.06)',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.accentSoft,
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {accountIcon(selected)}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 15, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {accountSubtitle(selected, t)}
          </span>
        </span>
        <span style={{ color: colors.textMuted, fontSize: 12, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              margin: 0,
              padding: 6,
              listStyle: 'none',
              borderRadius: 14,
              border: `1px solid ${colors.border}`,
              background: colors.bgCard,
              boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)',
              zIndex: 60,
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {showAllOption ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!props.value}
                  onClick={() => {
                    props.onChange('');
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    border: 'none',
                    borderRadius: 10,
                    background: !props.value ? colors.accentSoft : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: colors.text,
                  }}
                >
                  <span style={{ fontSize: 16 }}>◉</span>
                  <span style={{ fontWeight: 600 }}>{t('common.allAccounts')}</span>
                </button>
              </li>
            ) : null}
            {treeRows.map(({ account: a, depth }) => (
              <li key={a.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={props.value === a.id}
                  onClick={() => {
                    props.onChange(a.id);
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    paddingLeft: 12 + depth * 18,
                    border: 'none',
                    borderRadius: 10,
                    background: props.value === a.id ? colors.accentSoft : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: colors.text,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{accountIcon(a)}</span>
                  <span>
                    <span style={{ display: 'block', fontWeight: depth > 0 ? 500 : 600 }}>{a.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: colors.textMuted }}>
                      {accountSubtitleShort(a, t)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
