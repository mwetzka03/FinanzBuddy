import type { ReactNode } from 'react';
import { useUi } from '../../lib/ui';

type AmountColProps = {
  col: number | string;
  children: ReactNode;
  /** Saldo-Karten ohne Vorzeichen-Farblogik */
  neutral?: boolean;
};

export function ThAmount({ col, children }: AmountColProps) {
  const ui = useUi();
  return (
    <div style={ui.thAmount} data-amount-col={String(col)} data-amount-header="">
      {children}
    </div>
  );
}

export function TdAmount({
  col,
  amountCents,
  neutral,
  children,
}: AmountColProps & { amountCents?: number }) {
  const ui = useUi();
  return (
    <div style={ui.tdAmountText(amountCents, neutral)} data-amount-col={String(col)}>
      {children}
    </div>
  );
}
