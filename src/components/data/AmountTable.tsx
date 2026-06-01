import { useRef, type ReactNode } from 'react';
import { useUi } from '../../lib/ui';
import { AmountBandLayer } from './AmountBandLayer';

type AmountTableProps = {
  children: ReactNode;
  minWidth?: number;
  className?: string;
};

/** Scrollable table container with continuous amount-column overlay bands. */
export function AmountTable({ children, minWidth, className }: AmountTableProps) {
  const ui = useUi();
  const tableRef = useRef<HTMLDivElement>(null);

  return (
    <div style={ui.tableScroll} className="fh-table-scroll">
      <div
        ref={tableRef}
        style={{ ...ui.table, ...(minWidth ? { minWidth } : {}) }}
        className={['fh-amount-table-target', className].filter(Boolean).join(' ')}
      >
        {children}
        <AmountBandLayer tableRef={tableRef} />
      </div>
    </div>
  );
}
