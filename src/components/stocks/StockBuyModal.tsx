import { useEffect, useMemo, useState } from 'react';
import type { Account, IsoDate } from '../../lib/types';
import { isDepotAccount } from '../../lib/accounts';
import { isoToday } from '../../lib/date';
import { parseEurToCents } from '../../lib/money';
import { createStockHolding, searchStockSuggestions } from '../../tauri/api';
import { Checkbox } from '../common/Checkbox';
import { Modal } from '../common/Modal';
import { DateInput } from '../DateInput';
import { StockSuggestField } from './StockSuggestField';
import { useLocale } from '../../i18n/LocaleProvider';

export type StockBuyPreset = {
  name: string;
  symbol: string;
  depotAccountId: string;
};

type StockBuyModalProps = {
  open: boolean;
  accounts: Account[];
  preset?: StockBuyPreset | null;
  defaultDepotAccountId?: string;
  onClose: () => void;
  onCreated: (holdingId: string) => Promise<void>;
  onError: (msg: string | null) => void;
};

export function StockBuyModal({
  open,
  accounts,
  preset,
  defaultDepotAccountId,
  onClose,
  onCreated,
  onError,
}: StockBuyModalProps) {
  const { t } = useLocale();
  const depotAccounts = useMemo(() => accounts.filter((a) => isDepotAccount(a)), [accounts]);

  const [name, setName] = useState('');
  const [isin, setIsin] = useState('');
  const [buyDate, setBuyDate] = useState<IsoDate>(() => isoToday());
  const [buyPrice, setBuyPrice] = useState('');
  const [shares, setShares] = useState('');
  const [depotAccountId, setDepotAccountId] = useState('');
  const [isTransfer, setIsTransfer] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBuyDate(isoToday());
    setBuyPrice('');
    setShares('');
    setIsTransfer(false);
    if (preset) {
      setName(preset.name);
      setIsin(preset.symbol);
      setDepotAccountId(preset.depotAccountId);
      return;
    }
    setName('');
    setIsin('');
    setDepotAccountId(defaultDepotAccountId || depotAccounts[0]?.id || '');
  }, [open, preset, defaultDepotAccountId, depotAccounts]);

  useEffect(() => {
    if (!open || preset) return;
    const query = isin.trim();
    if (query.length < 12) {
      setName('');
      return;
    }
    let alive = true;
    searchStockSuggestions(query, 'isin')
      .then((rows) => {
        if (!alive) return;
        const match =
          rows.find((row) => (row.isin ?? row.symbol).toUpperCase() === query.toUpperCase()) ?? rows[0];
        setName(match?.name ?? '');
      })
      .catch(() => {
        if (alive) setName('');
      });
    return () => {
      alive = false;
    };
  }, [isin, open, preset]);

  const canSubmit = preset
    ? Boolean(depotAccountId && buyPrice.trim() && shares.trim())
    : Boolean(name.trim() && isin.trim() && depotAccountId && buyPrice.trim() && shares.trim());

  async function submit() {
    if (!canSubmit) return;
    onError(null);
    setBusy(true);
    try {
      const holdingId = await createStockHolding({
        name: (preset?.name ?? name).trim(),
        symbol: (preset?.symbol ?? isin).trim().toUpperCase(),
        buyDate,
        buyPriceCents: parseEurToCents(buyPrice),
        shares: Number(shares.replace(',', '.')),
        depotAccountId: depotAccountId || null,
        paymentAccountId: null,
        isTransfer,
      });
      await onCreated(holdingId);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      wide
      title={preset ? t('stocks.addOrder') : t('stocks.newOrder')}
      onClose={onClose}
    >
      <p className="fh-form-hint">{t('stocks.formHint')}</p>
      <div className="fh-form">
        {preset ? (
          <>
            <label>
              {t('stocks.resolvedName')}
              <div className="fh-form-readonly">{preset.name}</div>
            </label>
            <label>
              {t('stocks.isin')}
              <div className="fh-form-readonly" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {preset.symbol}
              </div>
            </label>
          </>
        ) : (
          <>
            <label>
              {t('stocks.isin')}
              <StockSuggestField
                mode="isin"
                isin={isin}
                name={name}
                onIsinChange={setIsin}
                onNameChange={setName}
                placeholder="DE0007164600"
              />
            </label>
            <label>
              {t('stocks.resolvedName')}
              <div className="fh-form-readonly">{name.trim() ? name : t('stocks.namePending')}</div>
            </label>
          </>
        )}
        <label>
          {t('stocks.depotAccount')}
          <select value={depotAccountId} onChange={(e) => setDepotAccountId(e.target.value)}>
            <option value="">–</option>
            {depotAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Checkbox checked={isTransfer} onChange={setIsTransfer} hint={t('stocks.isTransferHint')}>
          {t('stocks.isTransfer')}
        </Checkbox>
        <div className="fh-form-row">
          <label>
            {t('stocks.buyDate')}
            <DateInput value={buyDate} onChange={setBuyDate} />
          </label>
          <label>
            {t('stocks.buyPrice')}
            <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="150,00" />
          </label>
          <label>
            {t('stocks.shares')}
            <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="10" />
          </label>
        </div>
        <div className="fh-form-actions">
          <button type="button" className="fh-btn ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <div className="fh-form-actions-right">
            <button type="button" className="fh-btn primary" onClick={() => void submit()} disabled={!canSubmit || busy}>
              {busy ? t('common.loading') : t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
