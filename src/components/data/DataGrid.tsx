import { useRef, type ReactNode } from 'react';
import { useUi } from '../../lib/ui';
import { AmountBandLayer } from './AmountBandLayer';

type DataGridProps = {
  columns: string;
  header: ReactNode;
  emptyMessage?: string;
  isEmpty?: boolean;
  minWidth?: number;
  children: ReactNode;
};

export function DataGrid({ columns, header, emptyMessage, isEmpty, minWidth, children }: DataGridProps) {
  const ui = useUi();
  const tableRef = useRef<HTMLDivElement>(null);

  return (
    <div style={ui.tableScroll} className="fh-table-scroll">
      <div
        ref={tableRef}
        style={{ ...ui.table, ...(minWidth ? { minWidth } : {}) }}
        className="fh-data-grid fh-amount-table-target"
      >
        <div style={{ ...ui.tableHead, gridTemplateColumns: columns }}>{header}</div>
        {isEmpty ? <div style={ui.emptyRow}>{emptyMessage ?? 'Keine Einträge.'}</div> : children}
        <AmountBandLayer tableRef={tableRef} />
      </div>
    </div>
  );
}

export function DataGridRow({
  columns,
  children,
  className,
}: {
  columns: string;
  children: ReactNode;
  className?: string;
}) {
  const ui = useUi();
  return (
    <div style={{ ...ui.tableRow, gridTemplateColumns: columns }} className={className}>
      {children}
    </div>
  );
}
